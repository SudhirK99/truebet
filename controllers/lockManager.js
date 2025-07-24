// lockManager.js
const queues = new Map();
const locks = new Map();

const MAX_QUEUE_LENGTH = 500;
const OPERATION_TIMEOUT = 10000; // 10 seconds
const LOCK_TIMEOUT = 3000; // Reduce lock timeout to 3 seconds
const RETRY_DELAY = 100; // Increase to 100ms

class TransactionError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'TransactionError';
    this.statusCode = statusCode;
  }
}

const acquireLock = async (key) => {
  if (locks.has(key)) {
    const lockTime = locks.get(key);
    if (Date.now() - lockTime > LOCK_TIMEOUT) {
      console.warn(`[WARN] Force releasing stale lock for key: ${key}`);
      locks.delete(key);
    } else {
      return false;
    }
  }
  locks.set(key, Date.now());
  return true;
};

const releaseLock = (key) => {
  locks.delete(key);
  console.log(`[INFO] Lock released for key: ${key}`);
};

const enqueueRequest = (key, operation, context = {}) => {
  return new Promise((resolve, reject) => {
    if (!queues.has(key)) {
      queues.set(key, []);
    }

    const queue = queues.get(key);
    
    if (queue.length >= MAX_QUEUE_LENGTH) {
      const error = new TransactionError(`Queue capacity exceeded for key: ${key}`, 429);
      console.error(`[ERROR] ${error.message}`);
      return reject(error);
    }

    // Add request metadata
    const request = {
      operation,
      resolve,
      reject,
      context,
      timestamp: Date.now(),
      retryCount: 0,
      maxRetries: context.maxRetries || 3
    };

    queue.push(request);
    console.log(`[INFO] Request enqueued for key: ${key}. Queue length: ${queue.length}`);

    if (queue.length === 1) {
      processQueue(key);
    }
  });
};

const withTimeout = (promise, timeout, operation) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new TransactionError(`Operation timed out after ${timeout}ms`, 408));
      }, timeout);
    })
  ]).finally(() => {
    if (operation && operation.cleanup) {
      operation.cleanup();
    }
  });
};

const processQueue = async (key) => {
  const queue = queues.get(key);
  if (!queue || queue.length === 0) {
    return;
  }

  const request = queue[0];
  const { operation, resolve, reject, context, timestamp, retryCount, maxRetries } = request;

  // Check if request has expired
  // if (Date.now() - timestamp > OPERATION_TIMEOUT) {
  //   queue.shift();
  //   reject(new TransactionError('Request expired', 408));
  //   processNextInQueue(key);
  //   return;
  // }

  try {
    if (await acquireLock(key)) {
      console.log(`[INFO] Processing operation for key: ${key}. Attempt: ${retryCount + 1}`);
      
      const result = await withTimeout(operation(), OPERATION_TIMEOUT, operation);
      queue.shift();
      resolve(result);
      
      releaseLock(key);
      processNextInQueue(key);
    } else {
      if (retryCount >= maxRetries) {
        queue.shift();
        reject(new TransactionError('Max retries exceeded', 429));
        processNextInQueue(key);
      } else {
        request.retryCount++;
        setTimeout(() => processQueue(key), RETRY_DELAY);
      }
    }
  } catch (error) {
    console.error(`[ERROR] Operation failed for key: ${key}`, error);
    
    if (error instanceof TransactionError) {
      queue.shift();
      reject(error);
    } else if (retryCount < maxRetries) {
      request.retryCount++;
      setTimeout(() => processQueue(key), RETRY_DELAY);
    } else {
      queue.shift();
      reject(new TransactionError(error.message || 'Operation failed', error.statusCode || 500));
    }
    
    releaseLock(key);
    processNextInQueue(key);
  }
};

const processNextInQueue = (key) => {
  const queue = queues.get(key);
  if (!queue || queue.length === 0) {
    queues.delete(key);
    console.log(`[INFO] Queue cleared for key: ${key}`);
    return;
  }
  setTimeout(() => processQueue(key), 0);
};

// Monitoring functions
const getQueueStats = () => ({
  queueCount: queues.size,
  lockCount: locks.size,
  queues: Array.from(queues.entries()).map(([key, queue]) => ({
    key,
    length: queue.length,
    oldestRequest: queue[0]?.timestamp || null
  }))
});

module.exports = {
  enqueueRequest,
  TransactionError,
  getQueueStats
};