import { Router } from "express";
import { requireAuth, adminOnly, staffOnly } from "../auth/auth.middleware";
import * as c from "./couriers.controller";

const router = Router();
router.use(requireAuth, staffOnly);

router.get("/", c.list);
router.post("/", adminOnly, c.create);
router.patch("/:id", adminOnly, c.rename);

export default router;
