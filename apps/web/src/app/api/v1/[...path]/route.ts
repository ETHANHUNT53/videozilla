import { apiRoute } from "@/server/api/handler";
import { ApiError } from "@/server/api/errors";

/** Unknown `/api/v1` paths get the standard JSON error (404 NOT_FOUND) instead of the HTML not-found page. */
const notFound = apiRoute({ auth: "public" }, async () => {
  throw new ApiError("NOT_FOUND");
});

export { notFound as DELETE, notFound as GET, notFound as PATCH, notFound as POST, notFound as PUT };
