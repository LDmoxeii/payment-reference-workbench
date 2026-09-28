import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, X } from "lucide-react";
import { BusinessError } from "../domain/errors";
import type { ApiErrorShape } from "../domain/models";
import { AcceptedObservationError } from "../services/workbench-service";
import "./WorkbenchNotice.css";

interface Notice {
  id: number;
  code: string;
  message: string;
}

interface NoticeContextValue {
  showError(error: unknown): void;
}

const NoticeContext = createContext<NoticeContextValue | null>(null);
let nextNoticeId = 0;

function describe(error: unknown): Omit<Notice, "id"> {
  if (error instanceof BusinessError) return { code: error.code, message: error.message };
  if (error instanceof AcceptedObservationError) return {
    code: error.observationError.code,
    message: error.observationError.message,
  };
  if (error instanceof Error) return { code: "CLIENT_ERROR", message: error.message };
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const value = error as Pick<ApiErrorShape, "code" | "message">;
    return { code: String(value.code), message: String(value.message) };
  }
  return { code: "REQUEST_FAILED", message: "请求失败，请查看页面中的错误详情。" };
}

export function WorkbenchNoticeProvider({ children, resetKey }: { children: ReactNode; resetKey?: string }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const previousResetKey = useRef(resetKey);
  const showError = useCallback((error: unknown) => {
    setNotice({ id: ++nextNoticeId, ...describe(error) });
  }, []);
  const context = useMemo(() => ({ showError }), [showError]);
  useEffect(() => {
    if (previousResetKey.current === resetKey) return;
    previousResetKey.current = resetKey;
    setNotice(null);
  }, [resetKey]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return <NoticeContext.Provider value={context}>
    {children}
    <div className="workbench-notice-region" aria-live="assertive" aria-atomic="true">
      {notice ? <div className="workbench-notice" role="alert" key={notice.id}>
        <AlertCircle size={19} aria-hidden="true" />
        <div className="workbench-notice__body"><strong>{notice.code}</strong><span>{notice.message}</span></div>
        <button type="button" className="workbench-notice__close" aria-label="关闭错误通知" onClick={() => setNotice(null)}><X size={17} aria-hidden="true" /></button>
      </div> : null}
    </div>
  </NoticeContext.Provider>;
}

/** ErrorBlock and CommandFeedback use this; pages may also announce errors outside those blocks. */
export function useWorkbenchNotice(): NoticeContextValue {
  return useContext(NoticeContext) ?? NO_NOTICE;
}

const NO_NOTICE: NoticeContextValue = { showError: () => undefined };
