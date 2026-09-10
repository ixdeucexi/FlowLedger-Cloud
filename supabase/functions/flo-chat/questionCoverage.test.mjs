import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const corpus=JSON.parse(readFileSync(new URL('./questionCoverage.json',import.meta.url),'utf8'));
test('evaluation inventory retains all 30 requested financial question headings',()=>{
  const headings=['currentmoney','datebalance','cashflow','purchases','spending','comparisons','bills','subscriptions','income','debt','snowball','credit','savings','emergency','budget','paycheckdependence','buffer','paycheckahead','monthahead','paycheckplanning','escape30_90dayplan','progress','whatif','search','unusual','fees','health','daily','weekly','monthly'];
  const ids=new Set(corpus.families.map(f=>f.family));
  assert.equal(ids.size,corpus.families.length);
  assert.deepEqual(Object.keys(corpus.userHeadingCoverage).sort(),headings.sort());
  for(const [heading,families] of Object.entries(corpus.userHeadingCoverage)){
    assert.ok(families.length,heading);for(const id of families)assert.ok(ids.has(id),`${heading}: ${id}`);
  }
});
test('coverage inventory is not mislabeled as successful model evaluation',()=>{
  assert.match(corpus.evaluationStatus,/not been verified|release-unverified/);
  for(const family of corpus.families){
    assert.ok(family.questions.length,family.family);assert.ok(family.limitations.length,family.family);
    assert.doesNotMatch(family.status,/^(?:pass|verified|complete)$/i);
  }
});
