import { Router } from 'express';
import {
  getCurrentTerms,
  acceptTerms,
  listTermsVersions,
  getTermsVersionById,
  createTermsDraft,
  updateTermsDraft,
  publishTermsVersion,
  listTermsAcceptances,
  createTermsDraftSchema,
  updateTermsDraftSchema,
  acceptTermsSchema,
} from '../controllers/terms.controller.js';
import { requireAuth, requireRole, optionalAuth } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';

const router = Router();

// Current active published terms and user's acceptance status
router.get('/current', optionalAuth, getCurrentTerms);

// Customer explicit acceptance endpoint
router.post('/accept', requireAuth, validateBody(acceptTermsSchema), acceptTerms);

// Admin-only Terms & Conditions management
router.get('/versions', requireAuth, requireRole(['admin']), listTermsVersions);
router.get('/versions/:id', requireAuth, requireRole(['admin']), getTermsVersionById);
router.post('/versions', requireAuth, requireRole(['admin']), validateBody(createTermsDraftSchema), createTermsDraft);
router.put('/versions/:id', requireAuth, requireRole(['admin']), validateBody(updateTermsDraftSchema), updateTermsDraft);
router.post('/versions/:id/publish', requireAuth, requireRole(['admin']), publishTermsVersion);
router.patch('/versions/:id/publish', requireAuth, requireRole(['admin']), publishTermsVersion);
router.get('/acceptances', requireAuth, requireRole(['admin']), listTermsAcceptances);

export default router;

