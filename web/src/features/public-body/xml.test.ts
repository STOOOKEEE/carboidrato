// Lecteur XML minimal du navigateur : éléments par nom local, texte décodé, documents mal formés refusés.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { childElement, childElements, parseXml, XmlSyntaxError } from "./xml";

describe("lecteur XML", () => {
  test("lit les éléments par leur nom local, quel que soit le préfixe d'espace de noms", () => {
    const root = parseXml(
      '<?xml version="1.0" encoding="UTF-8"?>\n<p:Root xmlns:p="urn:x" versione="1"><p:A>un</p:A><B attr="a > b">deux</B><C/></p:Root>',
    );
    assert.equal(root.name, "Root");
    assert.deepEqual(
      root.children.map(({ name }) => name),
      ["A", "B", "C"],
    );
    assert.equal(childElement(root, "A")?.text, "un");
    assert.equal(childElement(root, "B")?.text, "deux");
    assert.equal(childElement(root, "C")?.text, "");
    assert.equal(childElement(root, "D"), undefined);
  });

  test("décode les entités, les CDATA et ignore les commentaires", () => {
    const root = parseXml("<R><!-- note --><T>A &amp; B &lt;&#65;&#x42;&gt; <![CDATA[<raw>]]></T></R>");
    assert.equal(childElement(root, "T")?.text, "A & B <AB> <raw>");
  });

  test("rend tous les enfants d'un même nom, dans l'ordre", () => {
    const root = parseXml("<R><L>1</L><M/><L>2</L></R>");
    assert.deepEqual(
      childElements(root, "L").map(({ text }) => text),
      ["1", "2"],
    );
  });

  test("ignore un BOM en tête de fichier", () => {
    assert.equal(parseXml("\uFEFF<R/>").name, "R");
  });

  const malformed: [string, string][] = [
    ["texte brut", "not xml at all"],
    ["JSON", '{"format":"bari.attested-invoice.v1"}'],
    ["balise non fermée", "<R><A></R>"],
    ["fermeture orpheline", "<R></R></A>"],
    ["deux racines", "<R/><S/>"],
    ["entité inconnue", "<R>&nbsp;</R>"],
    ["DOCTYPE", '<!DOCTYPE R [<!ENTITY x "y">]><R>&x;</R>'],
    ["document vide", ""],
  ];
  for (const [label, source] of malformed) {
    test(`refuse un document mal formé : ${label}`, () => {
      assert.throws(() => parseXml(source), XmlSyntaxError);
    });
  }
});
