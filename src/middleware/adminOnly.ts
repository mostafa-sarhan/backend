import { Request, Response, NextFunction } from "express";

export const adminOnly = (req: Request, res: Response, next: NextFunction) => {
  if (!(req as any).user || (req as any).user.role !== "admin") {
    return res.status(403).json({ message: "Admins only" });
  }
  next();
};
