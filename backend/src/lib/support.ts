import { Prisma, type SupportDialogStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const activeSupportDialogStatuses: SupportDialogStatus[] = [
  "new",
  "in_progress",
  "waiting_user",
];

export const supportDialogInclude = Prisma.validator<Prisma.SupportDialogInclude>()({
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      level: true,
      currentTask: true,
    },
  },
  assignedTo: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  },
  messages: {
    include: {
      senderUser: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
      fileAsset: {
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  },
});

export type SupportDialogWithRelations = Prisma.SupportDialogGetPayload<{
  include: typeof supportDialogInclude;
}>;

export function serializeSupportDialog(dialog: SupportDialogWithRelations) {
  return {
    ...dialog,
    messages: dialog.messages.map((message) => ({
      ...message,
      senderName:
        message.senderUser?.name ??
        (message.senderRole === "user" ? dialog.userName : "Команда платформы"),
    })),
  };
}

export function getSupportAssignees() {
  return prisma.user.findMany({
    where: {
      status: "active",
      role: { in: ["support", "mentor"] },
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
}
