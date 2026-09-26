export function createSafeRender(renderFn: () => void, onError: (err: unknown) => void = console.error): () => void {
  return () => {
    try {
      renderFn();
    } catch (err) {
      onError(err);
    }
  };
}
