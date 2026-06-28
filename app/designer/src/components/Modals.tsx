/** Lightweight overlay dialogs: keyboard shortcuts and an API usage snippet. */
export function Modals({
  modal,
  onClose,
  templateName,
  sampleData
}: {
  modal: null | 'shortcuts' | 'api';
  onClose: () => void;
  templateName: string;
  sampleData: string;
}) {
  if (!modal) return null;

  let dataLine = '{ ... }';
  try {
    dataLine = JSON.stringify(JSON.parse(sampleData));
  } catch {
    /* keep placeholder */
  }
  const curl = `curl -X POST ${window.location.origin}/api/v1/templates/${templateName}/generate \\
  -H "Content-Type: application/json" \\
  -d '{"version":"latest","returnMode":"base64","data":${dataLine}}'`;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        {modal === 'shortcuts' ? (
          <>
            <h3>Keyboard shortcuts</h3>
            <table className="shortcuts">
              <tbody>
                <tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>Save draft</td></tr>
                <tr><td><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd></td><td>Undo / redo (layout and data together)</td></tr>
                <tr><td><kbd>Ctrl</kbd>+<kbd>D</kbd></td><td>Duplicate the selected window or element</td></tr>
                <tr><td>Arrow keys</td><td>Nudge by 1pt (<kbd>Shift</kbd> = 10pt)</td></tr>
                <tr><td><kbd>Del</kbd></td><td>Delete the selection</td></tr>
                <tr><td>Double-click</td><td>Open properties for a window or element</td></tr>
                <tr><td><kbd>Ctrl</kbd>+scroll</td><td>Zoom in and out</td></tr>
              </tbody>
            </table>
          </>
        ) : (
          <>
            <h3>Generate PDFs via the API</h3>
            <p>
              Once a version is <strong>published</strong>, any system can render this template by
              posting data to the runtime endpoint. The current sample data is included below as the
              payload:
            </p>
            <pre className="mono">{curl}</pre>
            <p className="muted">
              The response contains <span className="mono">contentBase64</span> — decode it to get the
              PDF bytes. Use <span className="mono">"version": 2</span> to pin a specific version.
            </p>
            <button onClick={() => navigator.clipboard?.writeText(curl)}>Copy command</button>
          </>
        )}
        <button className="dialog-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
