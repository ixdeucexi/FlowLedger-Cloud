import assert from "node:assert/strict";
import test from "node:test";

import {
  hasBucketRemainderFunding,
  latestBucketRemainderAvailableDate,
  removeBucketRemainderFundingSource,
  replaceBillSurplusFundingSource,
  replaceBucketRemainderFundingSource,
  resizeSnowballFundingSources,
} from "./snowballFunding";

test("a debt underpayment becomes snowball funding instead of an ordinary transaction", () => {
  const sources = replaceBillSurplusFundingSource(
    [{ type: "manual", amount: 5 }],
    5,
    { type: "bill_surplus", amount: 30, billId: "discover", billName: "Discover" },
  );

  assert.deepEqual(sources, [
    { type: "manual", amount: 5 },
    { type: "bill_surplus", amount: 30, billId: "discover", billName: "Discover" },
  ]);
  assert.equal(sources.reduce((sum, source) => sum + source.amount, 0), 35);
});

test("rerouting the same debt underpayment replaces its prior snowball contribution", () => {
  const sources = replaceBillSurplusFundingSource(
    [
      { type: "bill_surplus", amount: 30, billId: "discover", billName: "Discover" },
      { type: "bill_surplus", amount: 12, billId: "insurance", reviewTransactionId: "review-1" },
    ],
    42,
    { type: "bill_surplus", amount: 20, billId: "discover", billName: "Discover" },
  );

  assert.deepEqual(sources, [
    { type: "bill_surplus", amount: 12, billId: "insurance", reviewTransactionId: "review-1" },
    { type: "bill_surplus", amount: 20, billId: "discover", billName: "Discover" },
  ]);
});

test("reducing a routed snowball payment releases the unused bill surplus", () => {
  const resized = resizeSnowballFundingSources([
    { type: "bill_surplus" as const, amount: 12.48, billId: "insurance", billName: "Car Insurance" },
  ], 10);

  assert.deepEqual(resized, [
    { type: "bill_surplus", amount: 10, billId: "insurance", billName: "Car Insurance" },
  ]);
});

test("increasing a routed payment preserves its surplus and adds manual extra", () => {
  const resized = resizeSnowballFundingSources([
    { type: "bill_surplus" as const, amount: 12.48, billId: "insurance" },
  ], 20);

  assert.deepEqual(resized, [
    { type: "bill_surplus", amount: 12.48, billId: "insurance" },
    { type: "manual", amount: 7.52 },
  ]);
});

test("funding amounts always equal the edited payment to the cent", () => {
  const resized = resizeSnowballFundingSources([
    { type: "manual" as const, amount: 5.555 },
    { type: "bill_surplus" as const, amount: 4.445, billId: "bill" },
  ], 8.01);

  assert.equal(resized.reduce((sum, source) => sum + source.amount, 0), 8.01);
});

test("a bucket remainder routes only once and keeps its own funding identity", () => {
  const routed = replaceBucketRemainderFundingSource([
    { type: "manual", amount: 10 },
    { type: "bucket_remainder", amount: 4, bucketId: "tia", bucketName: "Old Tia", availableDate: "2026-08-20" },
    { type: "bucket_remainder", amount: 1, bucketId: "tia", bucketName: "Duplicate", availableDate: "2026-08-20" },
  ], 15, {
    type: "bucket_remainder",
    amount: 5,
    bucketId: "tia",
    bucketName: "Tia",
    availableDate: "2026-08-20",
  });
  assert.deepEqual(routed, [
    { type: "manual", amount: 10 },
    { type: "bucket_remainder", amount: 5, bucketId: "tia", bucketName: "Tia", availableDate: "2026-08-20" },
  ]);
  assert.deepEqual(removeBucketRemainderFundingSource(routed, "tia"), [
    { type: "manual", amount: 10 },
  ]);
});

test("payment resizing preserves routed bucket money until the bucket is reopened", () => {
  const sources = [
    { type: "manual" as const, amount: 10 },
    { type: "bucket_remainder" as const, amount: 5, bucketId: "tia", bucketName: "Tia", availableDate: "2026-08-20" },
  ];
  assert.deepEqual(resizeSnowballFundingSources(sources, 12), [
    { type: "bucket_remainder", amount: 5, bucketId: "tia", bucketName: "Tia", availableDate: "2026-08-20" },
    { type: "manual", amount: 7 },
  ]);
  assert.throws(() => resizeSnowballFundingSources(sources, 4), /Reopen a routed spending bucket/);
  assert.throws(() => resizeSnowballFundingSources(sources, 0), /Reopen a routed spending bucket/);
});

test("bucket funding exposes its latest immutable availability date", () => {
  const sources = [
    { type: "bucket_remainder" as const, amount: 5, bucketId: "tia", availableDate: "2026-08-20" },
    { type: "manual" as const, amount: 2 },
    { type: "bucket_remainder" as const, amount: 3, bucketId: "school", availableDate: "2026-09-03" },
  ];
  assert.equal(hasBucketRemainderFunding(sources), true);
  assert.equal(latestBucketRemainderAvailableDate(sources), "2026-09-03");
  assert.equal(hasBucketRemainderFunding([{ type: "manual", amount: 2 }]), false);
});
