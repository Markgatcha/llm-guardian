import { Compass } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/Card";
import { Button } from "@/components/ui";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="max-w-lg text-center">
        <CardHeader>
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-brand-500/20 bg-brand-500/10 text-brand-100">
            <Compass className="h-6 w-6" />
          </div>
          <CardTitle className="mt-4 text-3xl">Page not found</CardTitle>
          <CardDescription>
            The page you requested does not exist in the dashboard. Head back to the overview to keep working.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/">
            <Button>Return to overview</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
