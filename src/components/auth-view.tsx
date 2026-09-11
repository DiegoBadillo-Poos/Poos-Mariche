"use client";

import { useState } from "react";
import { useFirebase, initiateEmailSignIn, initiateEmailSignUp } from "@/firebase";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { AppLogo } from "./icons";
import { Loader2, Mail, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { doc, setDoc, getDoc } from "firebase/firestore";

const SESSION_KEY = 'mm_session_id';

export function AuthView() {
  const { auth, firestore } = useFirebase();
  const { toast } = useToast();
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth || !firestore) return;
    
    setIsLoading(true);
    try {
      let userCredential;
      if (isLogin) {
        userCredential = await initiateEmailSignIn(auth, email, password);
      } else {
        userCredential = await initiateEmailSignUp(auth, email, password);
      }

      const user = userCredential.user;
      
      // GENERACIÓN DE SESIÓN ÚNICA ATÓMICA
      const newSessionId = crypto.randomUUID();
      
      // 1. Guardamos localmente DE INMEDIATO
      localStorage.setItem(SESSION_KEY, newSessionId);

      const profileRef = doc(firestore, 'users', user.uid);
      const profileSnap = await getDoc(profileRef);
      
      // 2. Actualizamos Firestore con el nuevo ID de sesión
      await setDoc(profileRef, {
        uid: user.uid,
        email: user.email,
        lastSessionId: newSessionId,
        updatedAt: new Date().toISOString(),
        ...( !profileSnap.exists() && {
            createdAt: new Date().toISOString(),
            licenseStatus: 'expired',
            enabledModules: ['inventory', 'pos', 'repairs', 'reports', 'expenses', 'analysis', 'fiados', 'inventory_aging', 'loans', 'exchange', 'payroll', 'treasury'],
            lockedModules: [],
            isPinRequired: false,
            businessRIF: "",
            businessAddress: ""
        })
      }, { merge: true });

      // No necesitamos redirigir, el cambio de estado 'user' activará el Dashboard
    } catch (error: any) {
      console.error("Auth error:", error);
      
      let message = "Ha ocurrido un error inesperado.";
      
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        message = "El correo o la contraseña son incorrectos.";
      } else if (error.code === 'auth/email-already-in-use') {
        message = "Este correo ya está registrado.";
      } else if (error.code === 'auth/weak-password') {
        message = "La contraseña es muy corta.";
      }

      toast({
        variant: "destructive",
        title: "Error de Acceso",
        description: message,
      });
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-md shadow-xl border-t-4 border-primary">
        <CardHeader className="text-center space-y-2">
          <div className="flex justify-center mb-2">
            <AppLogo className="w-16 h-16 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">
            {isLogin ? "POS Mariche" : "Registro de Negocio"}
          </CardTitle>
          <CardDescription>
            {isLogin 
              ? "Ingresa tus credenciales para acceder." 
              : "Crea tu cuenta corporativa para empezar."}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Correo Electrónico</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@posmariche.com"
                  className="pl-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  className="pl-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button className="w-full h-11 text-base font-semibold" disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isLogin ? "Iniciar Sesión" : "Crear Mi Tienda"}
            </Button>
            <div className="text-center text-sm">
              <span className="text-muted-foreground">
                {isLogin ? "¿No tienes una cuenta?" : "¿Ya tienes una cuenta?"}
              </span>
              <button
                type="button"
                className="ml-1 text-primary font-semibold hover:underline"
                onClick={() => {
                  setIsLogin(!isLogin);
                  setIsLoading(false);
                }}
                disabled={isLoading}
              >
                {isLogin ? "Registrar negocio" : "Iniciar sesión"}
              </button>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
