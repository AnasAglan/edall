import { useEffect } from "react";

const Index = () => {
  useEffect(() => {
    window.location.href = "/ed_master.html";
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">جاري التحميل...</h1>
      </div>
    </div>
  );
};

export default Index;
