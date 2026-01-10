// generator/server.js
// ESM module. IMPORTANT: do not duplicate imports or redeclare `app`.

import { createApp } from "./server/createApp.js";

const port = 5173;
const app = createApp({ port });

app.listen(port, () => console.log(`Generator running: http://localhost:${port}`));
