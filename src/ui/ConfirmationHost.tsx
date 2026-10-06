import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { answerConfirmation, getConfirmation, subscribeConfirmation } from "./confirmation";
import "./ConfirmationHost.css";

/** Non-blocking business confirmation: no command is accepted without an explicit choice. */
export function ConfirmationHost() {
  const request = useSyncExternalStore(subscribeConfirmation, getConfirmation, () => undefined);
  const overlay = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!request || !overlay.current) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const siblings = [...document.body.children].filter((item) => item !== overlay.current) as HTMLElement[];
    const previousInert = siblings.map((item) => item.inert);
    const previousOverflow = document.body.style.overflow;
    siblings.forEach((item) => { item.inert = true; });
    document.body.style.overflow = "hidden";
    cancel.current?.focus();
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.current?.contains(event.target)) cancel.current?.focus();
    };
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("focusin", onFocus);
      siblings.forEach((item, index) => { item.inert = previousInert[index]; });
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [request?.id]);
  if (!request) return null;
  const [title, ...detail] = request.message.split("\n");
  return createPortal(<div className="confirmation-backdrop" ref={overlay}>
    <div className="confirmation-dialog" ref={dialog} role="dialog" aria-modal="true"
      aria-labelledby="business-confirmation-title" aria-describedby="business-confirmation-detail"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation(); answerConfirmation(request.id, false);
        } else if (event.key === "Tab") {
          const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>("button");
          const first = buttons?.[0]; const last = buttons?.[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <span className="confirmation-dialog__eyebrow">请核对业务操作</span>
      <h2 id="business-confirmation-title">{title}</h2>
      <div id="business-confirmation-detail" className="confirmation-dialog__detail">{detail.join("\n").trim() || "确认后将按当前输入继续操作。取消不会发送命令或清空输入。"}</div>
      <p className="confirmation-dialog__hint">取消不会发送命令；确认后仍由后端裁决业务结果。</p>
      <div className="confirmation-dialog__actions">
        <button className="button" ref={cancel} type="button" onClick={() => answerConfirmation(request.id, false)}>取消操作</button>
        <button className="button button--danger" type="button" onClick={() => answerConfirmation(request.id, true)}>确认继续</button>
      </div>
    </div>
  </div>, document.body);
}
