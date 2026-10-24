import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User, Role } from "../models/User";
import { config } from "../config";

export const auth = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { id: string };

    const user = await User.findById(decoded.id).select("-password");
    if (!user) return res.status(401).json({ message: "Invalid token" });

    req.user = { _id: user._id.toString(), email: user.email, role: user.role as Role };
    next();
  } catch {
    res.status(401).json({ message: "Unauthorized" });
  }
};
