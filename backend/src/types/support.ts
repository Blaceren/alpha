export type SupportDialogStatus =
  | "new"
  | "in_progress"
  | "waiting_user"
  | "closed";

export type SupportActorRole = "user" | "admin" | "support" | "mentor";

export type SupportAssignee = {
  id: number;
  name: string;
  email: string;
  role: "support" | "mentor";
};

export type SupportMessage = {
  id: number;
  dialogId: number;
  senderUserId: number | null;
  senderRole: SupportActorRole;
  senderName: string;
  message: string;
  fileAssetId: number | null;
  fileAsset?: {
    id: number;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
  } | null;
  internalNote: boolean;
  createdAt: string;
};

export type SupportDialog = {
  id: number;
  userId: number;
  userName: string;
  userLevel: number;
  currentStep: string;
  status: SupportDialogStatus;
  assignedToId: number | null;
  assignedTo: SupportAssignee | null;
  lastMessage: string;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
  messages?: SupportMessage[];
};

export const supportStatusLabels: Record<SupportDialogStatus, string> = {
  new: "новый",
  in_progress: "в работе",
  waiting_user: "ожидает ответа пользователя",
  closed: "закрыт",
};

export const supportDialogStatuses = Object.keys(
  supportStatusLabels,
) as SupportDialogStatus[];
