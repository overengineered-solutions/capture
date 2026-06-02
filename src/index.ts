export { CaptureBubble } from './capture-bubble';
export type {
  CaptureBubbleProps,
  CaptureTabKey,
  ReportKind,
  TodoPriority,
  ExistingTodo,
  CapturedContext,
  CaptureTodoResult,
} from './types';

// v0.2.0 self-styling: the scoped CSS + idempotent injector. Hosts don't need
// to call these (the bubble injects on mount), but they're exported so an
// error boundary or a custom mount can prime styles before first paint.
export {
  ensureCaptureStyles,
  CAPTURE_STYLE_ELEMENT_ID,
  CAPTURE_STYLES_CSS,
  CAPTURE_THEME_DEFAULTS_CSS,
} from './styles';

// v0.2.0 auto-diagnostics: ring buffer + browser-context gatherer.
export {
  installErrorCapture,
  recordError,
  getRecentErrors,
  clearRecentErrors,
  gatherBrowserContext,
  gatherDiagnostics,
  serializeDiagnostics,
  MAX_RECENT_ERRORS,
  MAX_STACK_CHARS,
  MAX_DIAGNOSTICS_BYTES,
} from './diagnostics';
export type {
  BrowserContext,
  CapturedError,
  Diagnostics,
  GathererGlobals,
} from './diagnostics';

// v0.2.0 opt-in masked screenshot: the capture fn + redaction toggle.
export {
  captureMaskedScreenshot,
  setRedaction,
  REDACTING_CLASS,
  CAPTURING_CLASS,
} from './screenshot';
export type { CaptureScreenshotResult } from './screenshot';
