type BugReportDialogModule = typeof import('./BugReportDialog')

export async function loadBugReportDialog(
  importer: () => Promise<BugReportDialogModule> = () => import('./BugReportDialog'),
) {
  const module = await importer()
  return { default: module.BugReportDialog }
}
