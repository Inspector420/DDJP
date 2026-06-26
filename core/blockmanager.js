// core/blockmanager.js
// Generates and ingests blocks — snapshots of derived state over an event range.
// Two clients with the same ordered events produce the same block.state.
// Depends on: StreamManager, StateDeriver, Logger

// BlockManager.init receives a sendFn already bound to the right channel:
//   init((type, content) => MatrixBridge.sendEvent(channelId, type, content))
// The channel routing decision lives in room.js, not here.

const BlockManager = (() => {
  let lastBlock = null;
  let blockSeq = 0;       // monotonic counter — never use Date.now() as a block ID
  let _sendFn = null;     // injected by room.js, already bound to the right channel

  // Called on every room entry by room.js
  function init(sendFn) {
    _sendFn = sendFn; // may be null if no checkpoints channel is available
  }

  // Generate a block from current stream state and post it to the checkpoints channel
  async function generate(userId) {
    const log = StreamManager.getLog();
    if (log.length === 0) {
      Logger.warn("BlockManager.generate: nothing to snapshot");
      return null;
    }

    const first = log[0].eventId;
    const last  = log[log.length - 1].eventId;
    const state = StateDeriver.derive(log);

    blockSeq += 1;
    const block = {
      block: blockSeq,
      covers: first + ".." + last,
      event_count: log.length,
      state: {
        queue: state.queue,
        playback: state.playback
          ? { videoId: state.playback.videoId, startedAt: state.playback.startedAt }
          : null
      },
      by: userId,
      dv: 1
    };

    Logger.debug("BlockManager: generating block #" + blockSeq + " over " + log.length + " events");

    if (_sendFn) {
      await _sendFn("ddjp.block", block);
    } else {
      Logger.warn("BlockManager.generate: no send function — block not posted");
    }

    lastBlock = block;
    return block;
  }

  // Ingest a block received from the checkpoints channel via StreamManager subscription
  function ingest(entry) {
    const b = entry.content;
    if (!b.covers || !b.state || typeof b.block !== "number") {
      Logger.warn("BlockManager: malformed block, ignoring");
      return;
    }
    // Accept the block with the higher sequence number
    if (!lastBlock || b.block > lastBlock.block) {
      lastBlock = b;
      Logger.debug("BlockManager: accepted block #" + b.block +
        " from " + b.by + " covering " + b.event_count + " events");
    }
  }

  function getLastBlock() { return lastBlock; }

  return { init, generate, ingest, getLastBlock };
})();
