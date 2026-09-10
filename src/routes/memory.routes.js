import express from 'express'
import MemoryController from '../controllers/Memory.controller.js'
let router = express.Router()

router.post('/', MemoryController.store)
router.post('/search', MemoryController.search)

export default router;