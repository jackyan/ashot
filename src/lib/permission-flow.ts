export type PermissionEnsureResult = "granted" | "denied" | "error";

type PermissionFlowDeps = {
  checkPermission: () => Promise<boolean>;
  requestPermission: () => Promise<boolean>;
};

export async function ensureScreenPermission({
  checkPermission,
  requestPermission,
}: PermissionFlowDeps): Promise<PermissionEnsureResult> {
  try {
    const hasPermission = await checkPermission();
    if (hasPermission) return "granted";

    await requestPermission();
    const hasPermissionAfterRequest = await checkPermission();
    return hasPermissionAfterRequest ? "granted" : "denied";
  } catch {
    return "error";
  }
}

