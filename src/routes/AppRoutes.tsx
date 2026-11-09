import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AdminPage from "../pages/AdminPage";
import HomePage from "../pages/HomePage";
import LoginPage from "../pages/auth/LoginPage";
import { authRepository } from "../repositories/authRepository";
function ProtectedHome(){const user=authRepository.getCurrentUser();if(!user)return <Navigate to="/login" replace/>;return user.role==="ADMIN"?<Navigate to="/admin" replace/>:<HomePage/>;}
function ProtectedAdmin(){const user=authRepository.getCurrentUser();if(!user)return <Navigate to="/login" replace/>;return user.role==="ADMIN"?<AdminPage/>:<Navigate to="/" replace/>;}
function AppRoutes(){return <BrowserRouter><Routes><Route path="/" element={<ProtectedHome/>}/><Route path="/admin" element={<ProtectedAdmin/>}/><Route path="/login" element={<LoginPage/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></BrowserRouter>;}
export default AppRoutes;