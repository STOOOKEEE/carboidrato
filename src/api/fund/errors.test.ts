// Messages d'erreur de l'API : ils s'affichent tels quels dans le front, donc en anglais et avec la solution.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ConnectionError, RippledError, TimeoutError } from "xrpl";
import { makeErrorHandler } from "./errors.js";

function reply() {
  const sent: { status?: number; body?: { error: string } } = {};
  const fake = {
    status(code: number) {
      sent.status = code;
      return fake;
    },
    send(body: { error: string }) {
      sent.body = body;
      return fake;
    },
  };
  return { sent, fake: fake as unknown as FastifyReply };
}

function handle(error: Error) {
  const { sent, fake } = reply();
  makeErrorHandler((hash) => `#/tx/${hash}`)(error, {} as FastifyRequest, fake);
  return sent;
}

describe("makeErrorHandler", () => {
  it("nœud injoignable : 502, message en anglais qui invite à réessayer", () => {
    for (const error of [new TimeoutError("Timeout for request"), new ConnectionError("websocket closed")]) {
      const { status, body } = handle(error);
      assert.equal(status, 502);
      assert.match(body?.error ?? "", /^The XRP Ledger node did not answer\. Try again in a few seconds\./);
    }
  });

  it("requête refusée par le nœud : 422, message en anglais", () => {
    const { status, body } = handle(new RippledError("actNotFound"));
    assert.equal(status, 422);
    assert.match(body?.error ?? "", /^The XRP Ledger node refused the request: actNotFound/);
  });

  it("bogue : 500, message générique en anglais", () => {
    const { status, body } = handle(new TypeError("x is undefined"));
    assert.equal(status, 500);
    assert.equal(body?.error, "Something went wrong on Atlas's side. Try again.");
  });
});
