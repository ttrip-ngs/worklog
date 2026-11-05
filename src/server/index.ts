import { Hono } from "hono";
import type { AppBindings } from "./auth";
import { requireUser } from "./auth";
import { handleError, NotFound } from "./http";
import { clients } from "./routes/clients";
import { contracts } from "./routes/contracts";
import { entries } from "./routes/entries";
import { months } from "./routes/months";
import { report } from "./routes/report";

const app = new Hono<AppBindings>();

const api = new Hono<AppBindings>();
api.use("*", requireUser);

api.get("/me", (c) => c.json(c.get("user")));

api.route("/", clients);
api.route("/", contracts);
api.route("/", entries);
api.route("/", months);
api.route("/", report);

// 未定義のパスもエラー形式を { error } に揃える
api.all("*", () => {
  throw new NotFound("API が見つかりません");
});

api.onError(handleError);

app.route("/api", api);

export default app;
