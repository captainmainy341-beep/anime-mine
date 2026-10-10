import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldHtml, fieldText } from '../src/renderer/lib/fields.mjs';

test('fieldHtml keeps <b>, </b> and <br> (case-insensitive)', () => {
  assert.equal(fieldHtml('a <b>word</b> b<br>c<BR/>d<br />e'), 'a <b>word</b> b<br>c<br>d<br>e');
  assert.equal(fieldHtml('<B>x</B>'), '<b>x</b>');
});

test('fieldHtml escapes <script> tags', () => {
  const out = fieldHtml('<script>alert(1)</script>');
  assert.equal(out, '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.ok(!out.includes('<script'));
});

test('fieldHtml neutralises <img onerror> payloads', () => {
  const out = fieldHtml('<img src=x onerror="alert(1)">');
  assert.equal(out, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.ok(!/<img/i.test(out));
});

test('fieldHtml escapes nested tags inside <b>', () => {
  const out = fieldHtml('<b><img src=x onerror=alert(1)></b>');
  assert.equal(out, '<b>&lt;img src=x onerror=alert(1)&gt;</b>');
});

test('fieldHtml drops attributes on <b> instead of keeping them', () => {
  assert.equal(fieldHtml('<b onmouseover="alert(1)">hi</b>'), '<b>hi</b>');
  assert.equal(fieldHtml('<b class="x" style="color:red">hi</b>'), '<b>hi</b>');
});

test('fieldHtml escapes quotes and angle brackets in plain text', () => {
  assert.equal(fieldHtml(`5 < 6 & "q" 'x' >`), '5 &lt; 6 &amp; &quot;q&quot; &#39;x&#39; &gt;');
});

test('fieldHtml does not double-escape stored entities', () => {
  assert.equal(fieldHtml('A &amp; B &lt;i&gt;'), 'A &amp; B &lt;i&gt;');
  assert.equal(fieldHtml('A & B'), 'A &amp; B');
});

test('fieldHtml handles empty and missing values', () => {
  assert.equal(fieldHtml(''), '');
  assert.equal(fieldHtml(undefined), '');
  assert.equal(fieldHtml(null), '');
});

test('fieldText turns <br> into newlines and strips other tags', () => {
  assert.equal(fieldText('line1<br>line2<br/>line3'), 'line1\nline2\nline3');
  assert.equal(fieldText('<b>word</b> <i>x</i>'), 'word x');
});

test('fieldText removes script and img payloads down to inert text', () => {
  assert.equal(fieldText('<script>alert(1)</script>'), 'alert(1)');
  assert.equal(fieldText('<img src=x onerror="alert(1)">'), '');
  assert.equal(fieldText('<b><img src=x onerror=alert(1)></b>'), '');
});

test('fieldText decodes the entities Anki stores', () => {
  assert.equal(fieldText('A &amp; B &lt; C &gt; D &quot;E&quot; &#39;F&#39;'), `A & B < C > D "E" 'F'`);
});

test('fieldText decodes &amp; only once', () => {
  assert.equal(fieldText('&amp;lt;'), '&lt;');
});

test('fieldText keeps a literal < that is not a tag', () => {
  assert.equal(fieldText('1 < 2 and 3 > 2'), '1 < 2 and 3 > 2');
});

test('round trip: fieldText(fieldHtml(x)) keeps the plain text of stored x', () => {
  const samples = ['A &amp; B', 'x &lt;y&gt; &quot;z&quot;', 'line1<br>line2', 'plain words', '<b>bold</b> &#39;q&#39;'];
  for (const raw of samples) {
    assert.equal(fieldText(fieldHtml(raw)), fieldText(raw), `round trip failed for ${JSON.stringify(raw)}`);
  }
  assert.equal(fieldText(fieldHtml('A &amp; B')), 'A & B');
});
