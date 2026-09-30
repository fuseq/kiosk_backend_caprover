import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareDeviceRows,
  parsePlaylistDurations,
  projectPlaybackRow,
  resolvePositionFromElapsed,
} from '../services/playback-telemetry.js';

test('parsePlaylistDurations', () => {
  assert.deepEqual(parsePlaylistDurations('a:5000|b:8000'), [5000, 8000]);
  assert.deepEqual(parsePlaylistDurations(''), []);
});

test('projectPlaybackRow aligns reports to same instant', () => {
  const sig = 'slide-a:5000|slide-b:5000';
  const a = projectPlaybackRow({
    elapsedMs: 1000,
    totalMs: 10000,
    ageMs: 200,
    playlistSignature: sig,
    index: 0,
    offsetMs: 1000,
  });
  const b = projectPlaybackRow({
    elapsedMs: 1150,
    totalMs: 10000,
    ageMs: 50,
    playlistSignature: sig,
    index: 0,
    offsetMs: 1150,
  });
  assert.equal(a.elapsedMs, 1200);
  assert.equal(b.elapsedMs, 1200);
  assert.equal(a.projectedIndex, b.projectedIndex);
});

test('compareDeviceRows uses projected spread for IN_SYNC near slide boundary', () => {
  const sig = 'slide-a:5000|slide-b:5000';
  const now = Date.now();
  const result = compareDeviceRows([
    {
      _id: '1',
      displayId: 'A',
      lastPlayback: {
        receivedAt: new Date(now - 900),
        syncEnabled: true,
        playlistSignature: sig,
        totalMs: 10000,
        elapsedMs: 4800,
        index: 0,
        offsetMs: 4800,
      },
    },
    {
      _id: '2',
      displayId: 'B',
      lastPlayback: {
        receivedAt: new Date(now - 90),
        syncEnabled: true,
        playlistSignature: sig,
        totalMs: 10000,
        elapsedMs: 5610,
        index: 1,
        offsetMs: 610,
      },
    },
  ], { thresholdMs: 1000 });

  assert.equal(result.comparison.verdict, 'IN_SYNC');
  assert.equal(result.comparison.projectedElapsedSpreadMs, 0);
});

test('resolvePositionFromElapsed', () => {
  const pos = resolvePositionFromElapsed(6200, [5000, 5000]);
  assert.equal(pos.index, 1);
  assert.equal(pos.offsetMs, 1200);
});
