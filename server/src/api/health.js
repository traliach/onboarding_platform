'use strict';

const express = require('express');

const STARTED_AT = Date.now();

function healthRouter() {
  const router = express.Router();
  router.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
    });
  });
  return router;
}

module.exports = { healthRouter };
