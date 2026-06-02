import { Router, type IRouter } from "express";
import healthRouter from "./health";
import plaidRouter from "./plaid";

const router: IRouter = Router();

router.use(healthRouter);
router.use(plaidRouter);

export default router;
