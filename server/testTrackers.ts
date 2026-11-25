export function getTestTrackerHtml(scenario: string): {
  status: number;
  html: string;
  delayMs?: number;
} {
  switch (scenario) {
    case 'editorial-manager':
      return {
        status: 200,
        html: `<!doctype html>
<html>
<head><title>Editorial Manager - Submissions Being Processed for Author</title></head>
<body>
  <h1>Editorial Manager - Author Main Menu</h1>
  <p>Tracker: Editorial Manager (editorialmanager.com)</p>
  <p>Submissions Being Processed for Author: Hossam AbdelMeguid</p>
  <table>
    <thead>
      <tr>
        <th>Manuscript Number</th>
        <th>Title</th>
        <th>Journal</th>
        <th>Initial Date Submitted</th>
        <th>Status Date</th>
        <th>Current Status</th>
        <th>Submission Type</th>
        <th>Handling Editor</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>EM-ENG-2026-0418</td>
        <td>Adaptive Thermal Management for High-Density Solid-State Battery Packs Under Rapid Cycling</td>
        <td>Journal of Energy Storage &amp; Systems</td>
        <td>2026-09-14</td>
        <td>2026-11-10</td>
        <td>Under Review</td>
        <td>Original Research Article</td>
        <td>Dr. Elena Vance</td>
      </tr>
      <tr>
        <td>EM-MAT-2026-1102 R1</td>
        <td>Microstructural Stability of Laser-Sintered Titanium Alloys in Corrosive Marine Environments</td>
        <td>Materials &amp; Computational Design</td>
        <td>2026-08-03</td>
        <td>2026-11-18</td>
        <td>Minor Revision Required</td>
        <td>Revised Manuscript (R1)</td>
        <td>Prof. Marcus Chen</td>
      </tr>
    </tbody>
  </table>
</body>
</html>`,
      };

    case 'research-square':
      return {
        status: 200,
        html: `<!doctype html>
<html>
<head><title>Research Square - Article Timeline</title></head>
<body>
  <h1>Research Square Article Timeline</h1>
  <p>Journal: Sustainable Civil Infrastructure Review</p>
  <p>Manuscript ID: RS-2026-88412</p>
  <h2>Title: Machine-Learning Surrogate Models for Real-Time Seismic Frame Diagnostics</h2>
  <p>Submitted: 2026-10-02</p>
  <p>Current Status: Peer Review Completed - Awaiting Editor Decision</p>
  <p>Status Date: 2026-11-21</p>
  <p>Reviews Completed: 3</p>
  <p>Editor: Editorial Team B</p>
  <ul>
    <li>2026-10-02: Manuscript Submitted</li>
    <li>2026-10-08: Editor Assigned</li>
    <li>2026-10-14: Under Review</li>
    <li>2026-11-21: Peer Review Completed - Awaiting Editor Decision</li>
  </ul>
</body>
</html>`,
      };

    case 'elsevier-authorhub':
      return {
        status: 200,
        html: `<!doctype html>
<html>
<head><title>Elsevier AuthorHub - Track Your Submission</title></head>
<body>
  <h1>Elsevier AuthorHub Submission Tracker</h1>
  <p>Journal: Applied Thermal Engineering</p>
  <p>Manuscript Number: ATE-D-26-03921</p>
  <p>Article Title: Multi-Objective Topology Optimization of Liquid-Cooled Cold Plates for Power Electronics</p>
  <p>Submission Date: 04/05/2026</p>
  <p>Current Status: With Editor</p>
  <p>Last Status Change Date: 06/07/2026</p>
  <p>Reviews completed: 0</p>
</body>
</html>`,
      };

    case 'status-change-v1':
      return {
        status: 200,
        html: `<!doctype html>
<html>
<head><title>Test Journal Tracker - Step 1</title></head>
<body>
  <h1>Journal Submission Status (Sandbox Test)</h1>
  <p>Journal: Test Journal of Applied Systems</p>
  <p>Manuscript Number: TEST-SANDBOX-001</p>
  <p>Title: Sandbox Verification Manuscript for Automated Transition Testing</p>
  <p>Submission Date: 2026-11-01</p>
  <p>Current Status: With Editor</p>
  <p>Status Date: 2026-11-05</p>
</body>
</html>`,
      };

    case 'status-change-v2':
      return {
        status: 200,
        html: `<!doctype html>
<html>
<head><title>Test Journal Tracker - Step 2</title></head>
<body>
  <h1>Journal Submission Status (Sandbox Test)</h1>
  <p>Journal: Test Journal of Applied Systems</p>
  <p>Manuscript Number: TEST-SANDBOX-001</p>
  <p>Title: Sandbox Verification Manuscript for Automated Transition Testing</p>
  <p>Submission Date: 2026-11-01</p>
  <p>Current Status: Under Review</p>
  <p>Status Date: 2026-11-24</p>
  <p>Reviews completed: 1</p>
</body>
</html>`,
      };

    case 'expired-signin':
      return {
        status: 200,
        html: `<!doctype html>
<html>
<head><title>Editorial Manager - Session Expired</title></head>
<body>
  <h1>Sign in to your account</h1>
  <p>Your session has expired due to inactivity. Please enter your username and password to log in.</p>
  <form>
    <label>Username</label><input type="text" />
    <label>Password</label><input type="password" />
    <button type="submit">Author Login</button>
  </form>
</body>
</html>`,
      };

    case 'missing-from-list':
      return {
        status: 200,
        html: `<!doctype html>
<html>
<head><title>Editorial Manager - Submissions Being Processed</title></head>
<body>
  <h1>Editorial Manager - Author Main Menu</h1>
  <p>Submissions Being Processed for Author</p>
  <table>
    <tbody>
      <tr>
        <td>EM-MAT-2026-1102 R1</td>
        <td>Microstructural Stability of Laser-Sintered Titanium Alloys in Corrosive Marine Environments</td>
        <td>Materials &amp; Computational Design</td>
        <td>2026-08-03</td>
        <td>2026-11-18</td>
        <td>Minor Revision Required</td>
      </tr>
    </tbody>
  </table>
</body>
</html>`,
      };

    case 'timeout':
      return {
        status: 200,
        delayMs: 20000,
        html: `<html><body>Delayed response</body></html>`,
      };

    case 'ai-error-gibberish':
      return {
        status: 200,
        html: `<html><body>System maintenance code 00x991.</body></html>`,
      };

    default:
      return {
        status: 404,
        html: `<html><body><h1>404 Not Found</h1><p>Test tracker scenario not found.</p></body></html>`,
      };
  }
}
