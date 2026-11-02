import assert from "node:assert/strict";
import test from "node:test";
import { desktopCalendarCells } from "./desktopCalendar";
import { openCalendarMonthCells } from "./openCalendarWeeks";

test("open months use four, five or six natural weeks without changing the shared 42-cell source", () => {
  for (const [year, month, count] of [[2026, 1, 28], [2026, 10, 35], [2026, 7, 42], [2028, 1, 35]]) {
    const source = desktopCalendarCells(year, month);
    source.forEach(Object.freeze);Object.freeze(source);
    const result = openCalendarMonthCells(source);
    assert.equal(source.length, 42);
    assert.equal(result.length, count);
    assert.ok(result.every((cell, index) => cell === source[index]), "Every visible date retains its original object and ordering.");
    assert.deepEqual(result.filter(cell => cell.inCurrentMonth), source.filter(cell => cell.inCurrentMonth));
    assert.ok(result.slice(-7).some(cell => cell.inCurrentMonth));
  }
});

test("all dates survive trimming across leap years, DST months and December/January boundaries", () => {
  for (let year = 2000; year <= 2040; year += 1) for (let month = 0; month < 12; month += 1) {
    const source = desktopCalendarCells(year, month), result = openCalendarMonthCells(source);
    assert.ok([28, 35, 42].includes(result.length));
    assert.equal(result.filter(cell => cell.inCurrentMonth).length, new Date(year, month + 1, 0).getDate());
    assert.equal(result[0].date, source[0].date);
    assert.equal(result.find(cell => cell.inCurrentMonth)!.day, 1);
    assert.ok(source.slice(result.length).every(cell => !cell.inCurrentMonth));
  }
});

test("empty input has no fabricated weeks and additional row data remains untouched", () => {
  assert.deepEqual(openCalendarMonthCells([]), []);
  const source = desktopCalendarCells(2027, 0).map(cell => ({ ...cell, balance: -123.45, events: [{ id: "pending", status: "pending" }] }));
  const before = JSON.stringify(source), result = openCalendarMonthCells(source);
  assert.equal(result[0], source[0]);assert.equal(result[0].events, source[0].events);
  assert.equal(JSON.stringify(source), before);
});
