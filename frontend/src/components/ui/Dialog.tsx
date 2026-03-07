import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/Button";

interface DialogContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titleId: string;
  descriptionId: string;
  contentRef: RefObject<HTMLDivElement | null>;
}

const DialogContext = createContext<DialogContextValue | undefined>(undefined);

function useDialogContext(): DialogContextValue {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error("Dialog components must be used within a Dialog.");
  }

  return context;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(", ");

  return Array.from(container.querySelectorAll<HTMLElement>(selector));
}

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const contentRef = useRef<HTMLDivElement>(null);

  const value = useMemo(
    () => ({
      open,
      onOpenChange,
      titleId,
      descriptionId,
      contentRef,
    }),
    [descriptionId, onOpenChange, open, titleId]
  );

  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
}

export function DialogContent({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const { open, onOpenChange, titleId, descriptionId, contentRef } = useDialogContext();
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    previousActiveElement.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
        return;
      }

      if (event.key !== "Tab" || !contentRef.current) {
        return;
      }

      const focusableElements = getFocusableElements(contentRef.current);
      if (focusableElements.length === 0) {
        event.preventDefault();
        contentRef.current.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      }

      if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    const focusTarget = contentRef.current;
    if (focusTarget) {
      const focusableElements = getFocusableElements(focusTarget);
      (focusableElements[0] ?? focusTarget).focus();
    }

    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveElement.current?.focus();
    };
  }, [contentRef, onOpenChange, open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={cn(
          "relative z-10 w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 shadow-[0_30px_80px_-40px_rgba(2,6,23,0.95)]",
          "animate-fade-in",
          className
        )}
        {...props}
      >
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 rounded-xl border border-slate-800 bg-slate-950/70 p-2 text-slate-400 transition-colors hover:text-white"
          aria-label="Close dialog"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>,
    document.body
  );
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-2 p-6 pb-0", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = useDialogContext();
  return (
    <h2 id={titleId} className={cn("text-xl font-semibold text-slate-50", className)} {...props} />
  );
}

export function DialogDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId } = useDialogContext();
  return (
    <p id={descriptionId} className={cn("text-sm leading-6 text-slate-400", className)} {...props} />
  );
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-3 p-6 pt-0 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

export function DialogClose({ onClick, children = "Close", ...props }: ButtonProps) {
  const { onOpenChange } = useDialogContext();

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          onOpenChange(false);
        }
      }}
      {...props}
    >
      {children}
    </Button>
  );
}
