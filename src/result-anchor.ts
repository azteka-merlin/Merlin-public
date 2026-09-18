export const RESULT_ANCHOR_ID = "resultado-acesso";

export function buildResultAnchorUrl(pathname: string, search: string) {
  const normalizedSearch = search && search.startsWith("?") ? search : search ? `?${search}` : "";
  return `${pathname}${normalizedSearch}#${RESULT_ANCHOR_ID}`;
}

type ResultPanelTarget = {
  scrollIntoView: (options: ScrollIntoViewOptions) => void;
};

export function focusResultPanelAfterRender(
  target: ResultPanelTarget | null,
  requestFrame: (callback: FrameRequestCallback) => number,
  schedule: (callback: () => void, delayMs: number) => number,
) {
  const focus = () => target?.scrollIntoView({ behavior: "smooth", block: "center" });
  requestFrame(() => {
    requestFrame(() => {
      focus();
      schedule(focus, 560);
    });
  });
}
