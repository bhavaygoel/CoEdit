/**
 * Helper to determine the "length" of an operation.
 */
function opLength(op) {
    if (typeof op.insert === 'string') return op.insert.length;
    if (op.insert != null) return 1; // object embed
    if (typeof op.retain === 'number') return op.retain;
    if (typeof op.delete === 'number') return op.delete;
    return 0;
}

/**
 * An Iterator to safely walk through an array of operations dynamically.
 */
class OpIterator {
    constructor(ops) {
        this.ops = ops || [];
        this.index = 0;
        this.offset = 0; 
    }

    hasNext() {
        return this.peekLength() < Infinity;
    }

    peekType() {
        if (this.index >= this.ops.length) return 'retain';
        const op = this.ops[this.index];
        if (op.delete != null) return 'delete';
        if (op.retain != null) return 'retain';
        if (op.insert != null) return 'insert';
        return 'retain';
    }

    peekLength() {
        if (this.index >= this.ops.length) return Infinity;
        return opLength(this.ops[this.index]) - this.offset;
    }

    next(length) {
        if (!length) length = Infinity;
        
        if (this.index >= this.ops.length) {
            return { retain: Infinity };
        }

        const nextOp = this.ops[this.index];
        const offset = this.offset;
        const opLen = opLength(nextOp);

        if (length >= opLen - offset) {
            length = opLen - offset;
            this.index += 1;
            this.offset = 0;
        } else {
            this.offset += length;
        }

        if (nextOp.delete != null) {
            return { delete: length };
        } else if (nextOp.retain != null) {
            const result = { retain: length };
            if (nextOp.attributes) result.attributes = nextOp.attributes;
            return result;
        } else if (nextOp.insert != null) {
            const result = {};
            if (typeof nextOp.insert === 'string') {
                result.insert = nextOp.insert.substring(offset, offset + length);
            } else {
                result.insert = nextOp.insert; 
            }
            if (nextOp.attributes) result.attributes = nextOp.attributes;
            return result;
        }
    }
}

class CustomDelta {
    constructor(ops) {
        if (Array.isArray(ops)) {
            this.ops = ops.slice();
        } else if (ops != null && Array.isArray(ops.ops)) {
            this.ops = ops.ops.slice();
        } else {
            this.ops = [];
        }
    }

    push(newOp) {
        if (opLength(newOp) === 0) return this; 
        
        let index = this.ops.length;
        let lastOp = this.ops[index - 1];

        // Shallow copy op, and shallow copy attributes if they exist
        newOp = { ...newOp };
        if (newOp.attributes) newOp.attributes = { ...newOp.attributes };

        if (lastOp) {
            if (newOp.delete != null && lastOp.delete != null) {
                this.ops[index - 1] = { delete: lastOp.delete + newOp.delete };
                return this;
            }
            
            const attrsMatch = JSON.stringify(newOp.attributes) === JSON.stringify(lastOp.attributes);
            if (attrsMatch) {
                if (typeof newOp.insert === 'string' && typeof lastOp.insert === 'string') {
                    this.ops[index - 1].insert = lastOp.insert + newOp.insert;
                    return this;
                }
                if (typeof newOp.retain === 'number' && typeof lastOp.retain === 'number') {
                    this.ops[index - 1].retain = lastOp.retain + newOp.retain;
                    return this;
                }
            }
        }
        
        this.ops.push(newOp);
        return this;
    }

    chop() {
        const lastOp = this.ops[this.ops.length - 1];
        if (lastOp && lastOp.retain != null && !lastOp.attributes) {
            this.ops.pop();
        }
        return this;
    }

    /**
     * Transforms the `other` Delta against `this` Delta.
     * `this`: delta that happened first (or has priority).
     * `other`: delta that happened concurrently to `this`.
     * Returns a new Delta: what `other` should be to apply to the newly updated document.
     */
    transform(other, priority = false) {
        const thisIter = new OpIterator(this.ops);
        const otherIter = new OpIterator(new CustomDelta(other).ops);
        const delta = new CustomDelta();

        while (thisIter.hasNext() || otherIter.hasNext()) {
            if (thisIter.peekType() === 'insert' && (priority || otherIter.peekType() !== 'insert')) {
                // this inserts text. Since it happened first (or has priority across concurrent inserts),
                // the other operation must retain over the inserted text to stay aligned.
                delta.push({ retain: opLength(thisIter.next()) });
            } else if (otherIter.peekType() === 'insert') {
                // other inserts text. It keeps inserting.
                delta.push(otherIter.next());
            } else {
                // both are either delete or retain
                const length = Math.min(thisIter.peekLength(), otherIter.peekLength());
                const thisOp = thisIter.next(length);
                const otherOp = otherIter.next(length);

                if (thisOp.delete != null) {
                    // `this` deleted the text! Therefore, whatever `other` did (retain or delete)
                    // isn't applicable anymore because the text is already gone.
                    // We simply ignore otherOp (drop it) by continuing.
                    continue;
                } else if (otherOp.delete != null) {
                    // `other` deleted text, and `this` retained it. Keep the delete!
                    delta.push(otherOp);
                } else {
                    // Both retained the text.
                    delta.push(otherOp);
                }
            }
        }

        return delta.chop();
    }

    compose(other) {
        const thisIter = new OpIterator(this.ops);
        const otherIter = new OpIterator(new CustomDelta(other).ops);
        const delta = new CustomDelta();

        while (thisIter.hasNext() || otherIter.hasNext()) {
            if (otherIter.peekType() === 'insert') {
                delta.push(otherIter.next());
            } else if (thisIter.peekType() === 'delete') {
                delta.push(thisIter.next());
            } else {
                const length = Math.min(thisIter.peekLength(), otherIter.peekLength());
                const thisOp = thisIter.next(length);
                const otherOp = otherIter.next(length);

                if (otherOp.retain != null) {
                    // otherOp retains the text produced by thisOp. Meaning we keep what thisOp did.
                    delta.push(thisOp);
                } else if (otherOp.delete != null && thisOp.retain != null) {
                    // otherOp deletes text that thisOp originally retained.
                    delta.push(otherOp);
                } else if (otherOp.delete != null && thisOp.insert != null) {
                    // otherOp deletes text that thisOp originally inserted.
                    // They perfectly cancel out! We simply drop both and push neither.
                }
            }
        }
        return delta.chop();
    }
}

module.exports = CustomDelta;
