import { createRequestHandler } from "./worker";

const handleRequest = createRequestHandler();

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
