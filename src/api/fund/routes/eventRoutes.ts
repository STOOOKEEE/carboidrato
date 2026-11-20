// Flux SSE (`GET /api/events`) : étapes, logs, transactions (hash, résultat, lien explorer) et opérations, en direct.

import type { ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import type { ApiContext } from "../context.js";
import type { ApiEvent } from "../events.js";

/** Commentaire SSE périodique : garde la connexion ouverte à travers les proxys. */
const HEARTBEAT_INTERVAL_MS = 15_000;
const HTTP_OK = 200;

function writeEvent(response: ServerResponse, event: ApiEvent): void {
  response.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export function registerEventRoutes(app: FastifyInstance, context: ApiContext): void {
  const streams = new Set<ServerResponse>();

  // À l'arrêt, les flux ouverts sont fermés pour que le serveur puisse s'éteindre.
  app.addHook("preClose", async () => {
    for (const stream of streams) stream.end();
  });

  app.get("/api/events", (request, reply) => {
    reply.hijack();
    const response = reply.raw;
    // En-têtes déjà posés par Fastify (CORS) : à recopier, la réponse étant écrite à la main.
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) response.setHeader(name, value);
    }
    response.writeHead(HTTP_OK, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    response.write(": flux des événements Bari\n\n");
    streams.add(response);
    const unsubscribe = context.events.subscribe((event) => writeEvent(response, event));
    const heartbeat = setInterval(() => response.write(": ping\n\n"), HEARTBEAT_INTERVAL_MS);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(response);
    });
  });
}
