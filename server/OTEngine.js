const CustomDelta = require('./CustomDelta');

/**
 * Transforms a client operation against an array of operations it missed.
 * Passes `true` to `priority` so the server's operations win ties.
 */
const transformOp = (clientDelta, missedServerOps) => {
    let transformedDelta = new CustomDelta(clientDelta);
    for (const serverOp of missedServerOps) {
        // Transform the client delta against the server op. 
        // Server op happened first/has priority, so we call serverOp.transform(clientDelta, true)
        transformedDelta = new CustomDelta(serverOp).transform(transformedDelta, true);
    }
    return transformedDelta;
};

/**
 * Applies a delta operation to an existing document using CustomDelta compose.
 */
const applyDelta = (currentDoc, delta) => {
    return new CustomDelta(currentDoc).compose(delta);
};

module.exports = {
    transformOp,
    applyDelta
};
