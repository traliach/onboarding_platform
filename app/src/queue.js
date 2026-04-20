'use strict';

const { Queue } = require('bullmq');
const IORedis = require('ioredis');

let connection = null;
let queue = null;

function createConnection(redisUrl) {
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

function getConnection(redisUrl) {
  if (connection === null) {
    connection = createConnection(redisUrl);
  }
  return connection;
}

function createQueue({ redisUrl, queueName }) {
  if (queue === null) {
    queue = new Queue(queueName, { connection: getConnection(redisUrl) });
  }
  return queue;
}

async function closeQueue() {
  if (queue !== null) {
    await queue.close();
    queue = null;
  }
  if (connection !== null) {
    await connection.quit();
    connection = null;
  }
}

module.exports = {
  createConnection,
  getConnection,
  createQueue,
  closeQueue,
};
