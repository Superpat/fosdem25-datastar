import { Hono } from "npm:hono";
import { ServerSentEventGenerator } from "./vendor/datastar-sdk/src/web/serverSentEventGenerator.ts";
import { serveStatic } from "npm:hono/deno";
import { debounce } from "jsr:@std/async/debounce";
import { DOMParser, Element } from "jsr:@b-fuze/deno-dom";
import { computed, effect, effectScope, signal } from "npm:alien-signals";
import { decodeHTML, encodeHTML } from "npm:entities";
import { html, raw } from "npm:hono/html";

const app = new Hono();

const pages: Record<string, ReturnType<typeof signal>> = {};
const doms: Record<string, ReturnType<typeof computed>> = {};

/**
 * @param {String} HTML representing a single node (which might be an Element,
                   a text node, or a comment).
 * @return {Node}
 */
function htmlToNode(dom, html) {
  const template = dom.createElement("template");
  template.innerHTML = html;
  const nNodes = template.content.childNodes.length;
  if (nNodes !== 1) {
    throw new Error(
      `html parameter must represent a single node; got ${nNodes}. ` +
        "Note that leading or trailing spaces around an element in your " +
        'HTML, like " <img/> ", get parsed as text nodes neighbouring ' +
        "the element; call .trim() on your input to avoid this.",
    );
  }
  return template.content.firstChild;
}

function parseDom(page: string, pageContent: string) {
  const dom = new DOMParser().parseFromString(pageContent, "text/html");
  const nodes = dom.querySelectorAll("body *");

  nodes.forEach((node) => {
    const uuid = crypto.randomUUID();
    if (!node.id) node.id = `PageEditorId-${uuid}`;
  });

  const pageEditor = dom.getElementById("pageEditorEditingArea");
  const pageScript = dom.getElementById("pageEditorscript");
  const pageStyle = dom.getElementById("pageEditorStyle");
  if (pageEditor) {
    if (pageScript) pageScript.parentNode.removeChild(pageScript);
    if (pageStyle) pageStyle.parentNode.removeChild(pageStyle);

    return dom;
  }

  if (pageScript) return dom;

  return dom;
}

async function watchPage(page: string, pageContent: string) {
  if (pages[page]) return;

  const watcher = Deno.watchFs(`./page/${page}`);
  pages[page] = signal(pageContent);
  doms[page] = computed(() => parseDom(page, pages[page]()));

  for await (const _ of watcher) {
    pages[page](await Deno.readTextFile(`./page/${page}`));
  }
}

app.get("/watch/:page", async (c) => {
  const page = c.req.param("page");
  const content = await Deno.readTextFile(`./page/${page}`);

  if (!(page in pages)) {
    watchPage(page, content);
  }

  let scope;
  return ServerSentEventGenerator.stream(async (stream) => {
    scope = effectScope(() => {
      effect(() => {
        const dom = doms[page]();
        stream.mergeFragments(doms[page]().documentElement.outerHTML);
      })
    });
  }, {
    onAbort: (_) => {
      if (scope) scope();
    }
  });
});

function delay(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

app.get("teacher", async (c) => {
  const signals = await ServerSentEventGenerator.readSignals(c.req.raw);
  if (!signals.success) return c.text("error");
  console.log(signals)

  return ServerSentEventGenerator.stream(async (stream) => {
    stream.removeFragments('#answer');

    stream.mergeFragments('<section id="answer">The teacher is answering</section>', { "mergeMode": "after", selector: "#form" });
    await delay(500);

    stream.mergeFragments('<section id="answer">The teacher is answering.</section>');
    await delay(500);

    stream.mergeFragments('<section id="answer">The teacher is answering..</section>');
    await delay(500);

    stream.mergeFragments('<section id="answer">The teacher is answering...</section>');
    await delay(500);

    if (signals.signals.question == 4) {
      stream.mergeFragments('<section id="answer">Your answer is correct :)</section>');
    } else {
      stream.mergeFragments('<section id="answer">Your answer is wrong :(</section>');
    }

    stream.close();
  });
});
/*
app.put("edit/:page", async (c) => {
  const page = c.req.param("page");
  const signals = await ServerSentEventGenerator.readSignals(c.req.raw);
  if (!signals.success) return c.text("error");

  const dom = doms[page]();
  console.log(signals.signals.pageeditor);
  const decoded = decodeHTML(signals.signals.pageeditor);
  if (signals.signals.pageeditor === "") {
    return c.text("empty pageeditor, doing nothing");
  }
  const parsed = html`${raw(decoded)}`.toString();
  const newHtml = htmlToNode(dom, parsed);

  const pageEditorButton = dom.getElementById("pageEditorButton");
  pageEditorButton.parentNode.removeChild(pageEditorButton);

  const pageEditor = dom.getElementById("pageEditorEditingArea");
  pageEditor.parentNode.replaceChild(newHtml, pageEditor);

  dom.getElementsByTagName("*").forEach((node) => {
    if (node.id.startsWith("PageEditorId")) node.removeAttribute("id");
  });

  await Deno.writeTextFile(`page/${page}`, dom.documentElement.outerHTML);

  const command = new Deno.Command("deno", {
    args: ["fmt", "./page"],
  });
  const child = command.spawn();
  await child.status;
});

app.post("edit/:page", async (c) => {
  const page = c.req.param("page");
  const dom = doms[page]();
  const json = await c.req.json();

  const elementToChange = dom.getElementById(json.elementId ?? "");
  if (!elementToChange) return c.text('element not found');
  elementToChange.getElementsByTagName("*").forEach((node) => {
    if (node.id.startsWith("PageEditorId")) node.removeAttribute("id");
  });
  if (elementToChange.id.startsWith("PageEditorId")) {
    elementToChange.removeAttribute("id");
  }

  const input = htmlToNode(
    dom,
    `<textarea id="pageEditorEditingArea" data-scroll-into-view__focus style="display:inline-block; padding: 0.5rem; " data-signals-pageeditor="" data-on-intersect="$pageeditor=evt.target.value" data-on-keydown="$pageeditor=evt.target.value" data-on-change="$pageeditor=evt.target.value" data-on-input="$pageeditor=evt.target.value"></textarea>`,
  );
  const inputContent = dom.createTextNode(elementToChange.outerHTML);
  input.appendChild(inputContent);

  const button = htmlToNode(
    dom,
    `<button id="pageEditorButton" data-on-click="@put('/edit/${page}')">Save</button>`,
  );

  elementToChange.parentNode.replaceChild(input, elementToChange);
  input.parentNode.appendChild(button);

  pages[page](dom.documentElement.outerHTML);

  return c.text("ok");
});
*/
app.get("/edit/:page", async (c) => {
  const page = c.req.param("page");

  const content = await Deno.readTextFile(`./page/${page}`);

  if (!(page in pages)) {
    watchPage(page, content);
  }
  const dom = doms[page]();

  const script = dom.createElement("script");
  script.setAttribute("id", "pageEditorscript");
  const scriptContent = dom.createTextNode(
    `let prev = null;

function onClick(event) {
  event.target.removeEventListener('click', onClick);
  fetch('/edit/${page}', {
    headers: {
      'Content-Type': 'application/json'
    },
    method: 'post',
    body: JSON.stringify({ elementId: event.target.id })
  });
}

function onMouseover(event) {
        const editingArea = document.getElementById('pageEditorEditingArea');

        if (event.target === document.body || (prev && prev === event.target)) {
            return;
        }

        if (prev) {
            prev.classList.remove('highlight');
            prev.removeEventListener('click', onClick);
            prev = null;
        }

        if (event.target && !editingArea) {
            prev = event.target;
            prev.classList.add('highlight');
            prev.addEventListener('click', onClick);
        }
}

document.addEventListener('DOMContentLoaded', function () {
  document.body.addEventListener(
      'mouseover',
      onMouseover,
      false
  );
})`,
  );
  script.appendChild(scriptContent);

  const style = dom.createElement("style");
  style.setAttribute("id", "pageEditorStyle");
  const styleContent = dom.createTextNode(
    ".highlight { background-color: red}",
  );
  style.appendChild(styleContent);

  const head = dom.getElementsByTagName("head")[0];
  head.appendChild(script);
  head.appendChild(style);

  return c.html("<!DOCTYPE html>".concat(dom.documentElement.outerHTML));
});

app.use("/page/*", serveStatic({ root: "./" }));

Deno.serve({ hostname: "0.0.0.0", port: 8787 }, app.fetch);
