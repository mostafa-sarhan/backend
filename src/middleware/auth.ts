import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User";

// استخدام النوع اللي اتعرف في express.d.ts
interface AuthRequest extends Request {
  user?: {
    _id: string;
    email: string;
    role: "admin" | "employee"; // 🟢 مهم: نفس النوع في d.ts
  };
}

export const auth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });

  try {
    const decoded: any = jwt.verify(token, process.env.JWT_SECRET!);

    const user = await User.findById(decoded.id).select("-password");
    if (!user) return res.status(401).json({ message: "Invalid token" });

    // Type assertion للتأكد لـ TypeScript
    req.user = {
      _id: user._id.toString(),
      email: user.email,
      role: user.role as "admin" | "employee", // 🟢 هنا
    };

    next();
  } catch (err) {
    console.error(err);
    res.status(401).json({ message: "Unauthorized" });
  }
};
