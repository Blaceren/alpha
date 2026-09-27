#!/usr/bin/env bash
#
# ATA production — create the AWS resources. Run from your WORKSTATION.
#
#   bash deploy/aws/provision.sh --domain example.com [--hosted-zone-id Z123...]
#
# IDEMPOTENT: every resource is looked up by tag or name first and only created
# if absent. Re-running after a partial failure continues where it stopped.
#
# It writes the resulting identifiers to deploy/aws/.provision-state (gitignored)
# so later steps and teardown do not have to re-discover them.
#
# WHAT IT DELIBERATELY DOES NOT DO
#   * No SSH key pair and no port 22. Access is via SSM Session Manager, which
#     needs no inbound rule at all — there is no open management port to find.
#   * No RDS, no load balancer. A single instance with SQLite on an EBS volume
#     is the architecture; see README.md for why, and what it costs.
#   * It does not format or mount the data volume. bootstrap.sh does that on the
#     instance, where it can refuse to erase a disk that already has data.

set -euo pipefail

die() { printf '\nREFUSING: %s\n' "$1" >&2; exit 1; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
note() { printf '    %s\n' "$1"; }

REGION="eu-central-1"
# c7i-flex.large: 2 vCPU / 4 GiB. Chosen over t3.medium because THIS ACCOUNT IS
# ON AN AWS FREE TIER PLAN, which refuses any instance type outside its
# free-tier-eligible list — t3.medium fails with InvalidParameterCombination.
# Of the eligible types, this is the smallest with enough memory to run a
# `next build` (m7i-flex.large is also eligible and gives 8 GiB if builds
# struggle; the 1 GiB micros cannot build these apps at all).
INSTANCE_TYPE="c7i-flex.large"
ROOT_GB=30
DATA_GB=20
NAME="ata-prod"
DOMAIN=""
HOSTED_ZONE_ID=""

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)         DOMAIN="${2:?}"; shift 2 ;;
    --hosted-zone-id) HOSTED_ZONE_ID="${2:?}"; shift 2 ;;
    --region)         REGION="${2:?}"; shift 2 ;;
    --instance-type)  INSTANCE_TYPE="${2:?}"; shift 2 ;;
    *) die "unknown argument '$1'" ;;
  esac
done

[ -n "$DOMAIN" ] || die "--domain is required"
command -v aws >/dev/null || die "aws CLI not found"

STATE_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.provision-state"
aws() { command aws --region "$REGION" "$@"; }

step "Identity"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)" \
  || die "aws sts get-caller-identity failed — run 'aws configure' first"
note "account $ACCOUNT_ID, region $REGION"

# ---------------------------------------------------------------------------
step "1/8  Network (default VPC)"
# ---------------------------------------------------------------------------
# The default VPC is used on purpose: one public instance needs no custom
# network, and a hand-rolled VPC here would be three more resources to maintain
# for no isolation benefit.
VPC_ID="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text)"
[ "$VPC_ID" != "None" ] || die "no default VPC in $REGION — create one, or adapt this script to an existing VPC"

SUBNET_ID="$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC_ID" \
  Name=default-for-az,Values=true --query 'Subnets[0].SubnetId' --output text)"
note "vpc $VPC_ID, subnet $SUBNET_ID"

# ---------------------------------------------------------------------------
step "2/8  Security group"
# ---------------------------------------------------------------------------
SG_ID="$(aws ec2 describe-security-groups \
  --filters Name=group-name,Values="${NAME}-sg" Name=vpc-id,Values="$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo None)"

if [ "$SG_ID" = "None" ]; then
  SG_ID="$(aws ec2 create-security-group --group-name "${NAME}-sg" \
    --description "ATA production: public HTTP/HTTPS only, no SSH" \
    --vpc-id "$VPC_ID" --query GroupId --output text)"
  # 80 is needed beyond the redirect: certbot's webroot renewal answers there.
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions \
      'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description="HTTP + ACME"}]' \
      'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description="HTTPS"}]' \
    >/dev/null
  note "created $SG_ID (80, 443 — deliberately NO 22)"
else
  note "exists: $SG_ID"
fi

# ---------------------------------------------------------------------------
step "3/8  S3 backup bucket"
# ---------------------------------------------------------------------------
BUCKET="${NAME}-backups-${ACCOUNT_ID}"   # account id makes it globally unique
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  note "exists: s3://$BUCKET"
else
  aws s3api create-bucket --bucket "$BUCKET" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  aws s3api put-public-access-block --bucket "$BUCKET" \
    --public-access-block-configuration \
    'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true' >/dev/null
  # Versioning is what turns "the backup script was compromised and uploaded
  # garbage over yesterday's good copy" from fatal into recoverable.
  aws s3api put-bucket-versioning --bucket "$BUCKET" \
    --versioning-configuration Status=Enabled >/dev/null
  aws s3api put-bucket-encryption --bucket "$BUCKET" \
    --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}' >/dev/null
  note "created s3://$BUCKET (private, versioned, encrypted)"
fi

# ---------------------------------------------------------------------------
step "4/8  IAM instance role"
# ---------------------------------------------------------------------------
ROLE="${NAME}-instance-role"
if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  note "exists: $ROLE"
else
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]
  }' >/dev/null
  # This is what replaces SSH. Without it there is no way into the box at all.
  aws iam attach-role-policy --role-name "$ROLE" \
    --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore >/dev/null
  note "created $ROLE with SSM access"
fi

# Write-only to the backup prefix: the instance can deposit backups but cannot
# list, read or delete them. A compromised instance cannot use these credentials
# to destroy the backups it made, which is most of the point of having them.
aws iam put-role-policy --role-name "$ROLE" --policy-name "${NAME}-backup-write" \
  --policy-document "{
    \"Version\":\"2012-10-17\",
    \"Statement\":[{
      \"Effect\":\"Allow\",
      \"Action\":[\"s3:PutObject\"],
      \"Resource\":\"arn:aws:s3:::${BUCKET}/db/*\"
    }]
  }" >/dev/null
note "backup policy: PutObject only, no Get/List/Delete"

if ! aws iam get-instance-profile --instance-profile-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$ROLE" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$ROLE" --role-name "$ROLE" >/dev/null
  note "instance profile created — waiting for IAM propagation"
  sleep 15
fi

# ---------------------------------------------------------------------------
step "5/8  EC2 instance"
# ---------------------------------------------------------------------------
INSTANCE_ID="$(aws ec2 describe-instances \
  --filters Name=tag:Name,Values="$NAME" \
            Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || echo None)"

if [ "$INSTANCE_ID" = "None" ]; then
  # Resolve the AMI by querying Canonical's published images directly.
  #
  # NOT via the /aws/service/canonical/... SSM public parameters, which is the
  # usual recipe and which DOES NOT RESOLVE in this account and region — every
  # candidate path (24.04 and noble, gp3 and gp2) returns None. Relying on it
  # would fail here at run-instances with "Invalid id: None", after the security
  # group, bucket and IAM role had already been created.
  #
  # 099720109477 is Canonical's AWS account. Pinning the owner is what makes
  # this safe: filtering by name alone would match any account's image that
  # chose a lookalike name.
  AMI_ID="$(aws ec2 describe-images --owners 099720109477 \
    --filters 'Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*' \
              'Name=state,Values=available' \
    --query 'reverse(sort_by(Images,&CreationDate))[0].ImageId' --output text)"
  [ -n "$AMI_ID" ] && [ "$AMI_ID" != "None" ] || die "could not resolve the Ubuntu 24.04 AMI"
  note "ami $AMI_ID"

  INSTANCE_ID="$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --subnet-id "$SUBNET_ID" \
    --security-group-ids "$SG_ID" \
    --iam-instance-profile "Name=$ROLE" \
    --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":${ROOT_GB},\"VolumeType\":\"gp3\",\"DeleteOnTermination\":true,\"Encrypted\":true}}]" \
    --metadata-options 'HttpTokens=required,HttpEndpoint=enabled' \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" \
    --query 'Instances[0].InstanceId' --output text)"
  note "launched $INSTANCE_ID — waiting for running state"
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
else
  note "exists: $INSTANCE_ID"
fi

# ---------------------------------------------------------------------------
step "6/8  Data volume"
# ---------------------------------------------------------------------------
# A SEPARATE volume from the root, deliberately. The instance can be rebuilt,
# resized or replaced without touching the database, and snapshots of this
# volume contain data and nothing else.
VOL_ID="$(aws ec2 describe-volumes --filters Name=tag:Name,Values="${NAME}-data" \
  --query 'Volumes[0].VolumeId' --output text 2>/dev/null || echo None)"

if [ "$VOL_ID" = "None" ]; then
  AZ="$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
    --query 'Reservations[0].Instances[0].Placement.AvailabilityZone' --output text)"
  VOL_ID="$(aws ec2 create-volume --availability-zone "$AZ" --size "$DATA_GB" \
    --volume-type gp3 --encrypted \
    --tag-specifications "ResourceType=volume,Tags=[{Key=Name,Value=${NAME}-data}]" \
    --query VolumeId --output text)"
  aws ec2 wait volume-available --volume-ids "$VOL_ID"
  note "created $VOL_ID (${DATA_GB} GiB, encrypted)"
fi

ATTACHED="$(aws ec2 describe-volumes --volume-ids "$VOL_ID" \
  --query 'Volumes[0].Attachments[0].InstanceId' --output text)"
if [ "$ATTACHED" = "None" ]; then
  aws ec2 attach-volume --volume-id "$VOL_ID" --instance-id "$INSTANCE_ID" --device /dev/sdf >/dev/null
  aws ec2 wait volume-in-use --volume-ids "$VOL_ID"
  note "attached to $INSTANCE_ID as /dev/sdf (appears as /dev/nvme1n1 on Nitro)"
else
  note "already attached to $ATTACHED"
fi

# ---------------------------------------------------------------------------
step "7/8  Elastic IP"
# ---------------------------------------------------------------------------
# Without this the public IP changes on every stop/start, which would break DNS
# and every issued certificate's renewal.
ALLOC_ID="$(aws ec2 describe-addresses --filters Name=tag:Name,Values="$NAME" \
  --query 'Addresses[0].AllocationId' --output text 2>/dev/null || echo None)"

if [ "$ALLOC_ID" = "None" ]; then
  ALLOC_ID="$(aws ec2 allocate-address --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" \
    --query AllocationId --output text)"
  note "allocated $ALLOC_ID"
fi

aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID" >/dev/null
PUBLIC_IP="$(aws ec2 describe-addresses --allocation-ids "$ALLOC_ID" \
  --query 'Addresses[0].PublicIp' --output text)"
note "public IP: $PUBLIC_IP"

# ---------------------------------------------------------------------------
step "8/8  DNS"
# ---------------------------------------------------------------------------
if [ -z "$HOSTED_ZONE_ID" ]; then
  HOSTED_ZONE_ID="$(command aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" \
    --query "HostedZones[?Name=='${DOMAIN}.'].Id | [0]" --output text 2>/dev/null | sed 's|/hostedzone/||')"
fi

if [ -z "$HOSTED_ZONE_ID" ] || [ "$HOSTED_ZONE_ID" = "None" ]; then
  note "No Route 53 hosted zone found for $DOMAIN."
  note "Create these A records at your DNS provider, all pointing to $PUBLIC_IP:"
  note "    api.$DOMAIN      A   $PUBLIC_IP"
  note "    academy.$DOMAIN  A   $PUBLIC_IP"
  note "    crm.$DOMAIN      A   $PUBLIC_IP"
else
  CHANGES=""
  for sub in api academy crm; do
    [ -n "$CHANGES" ] && CHANGES="${CHANGES},"
    CHANGES="${CHANGES}{\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"${sub}.${DOMAIN}\",\"Type\":\"A\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"${PUBLIC_IP}\"}]}}"
  done
  command aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" \
    --change-batch "{\"Changes\":[${CHANGES}]}" >/dev/null
  note "upserted api/academy/crm.$DOMAIN -> $PUBLIC_IP (TTL 300)"
fi

# ---------------------------------------------------------------------------
cat > "$STATE_FILE" <<EOF
# Generated by provision.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Not a secret,
# but not tracked either — these ids identify live, billable resources.
ATA_REGION=$REGION
ATA_ACCOUNT_ID=$ACCOUNT_ID
ATA_INSTANCE_ID=$INSTANCE_ID
ATA_VOLUME_ID=$VOL_ID
ATA_ALLOCATION_ID=$ALLOC_ID
ATA_PUBLIC_IP=$PUBLIC_IP
ATA_SECURITY_GROUP=$SG_ID
ATA_BACKUP_BUCKET=$BUCKET
ATA_IAM_ROLE=$ROLE
ATA_DOMAIN=$DOMAIN
EOF

cat <<EOF

------------------------------------------------------------------
Provisioned. State written to $STATE_FILE

  instance : $INSTANCE_ID  ($INSTANCE_TYPE)
  public IP: $PUBLIC_IP
  data vol : $VOL_ID -> /dev/sdf
  backups  : s3://$BUCKET

Connect (no SSH key, no open port 22):
  aws ssm start-session --target $INSTANCE_ID --region $REGION

If that fails, give the SSM agent a minute after first boot to register.

Next: README.md step 1 — bootstrap the instance.
------------------------------------------------------------------
EOF
