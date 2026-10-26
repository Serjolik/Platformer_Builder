import assert from "node:assert/strict";
import test from "node:test";

test("serves the constructor shell and client-side project loading state", async () => {
  const { default: worker } = await import("../dist/server/index.js");
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /конструктор игровых локаций/);
  assert.match(html, /Навигация по проекту/);
  assert.doesNotMatch(html, /Режим редактора/);
  assert.match(html, />Экспорт<\/button>/);
  assert.doesNotMatch(html, /В Unreal…|Экспорт JSON/);
  assert.match(html, /Загрузка проекта/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});
