/**
 * Saving a file the app made, on the user's device. The XML becomes a Blob
 * the browser saves under the given name: nothing is uploaded, and the URL
 * is revoked once the save has started, so the text is not kept around.
 */
export function saveFile(fileName: string, xml: string): void {
  const url = URL.createObjectURL(
    new Blob([xml], { type: "application/xml;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.click();
  // After the click has been handled: revoking first would cancel the save.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
