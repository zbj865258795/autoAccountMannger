import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Dashboard from "./pages/Dashboard";
import Accounts from "./pages/Accounts";
import ImportAccounts from "./pages/ImportAccounts";
import InvitationTree from "./pages/InvitationTree";
import Automation from "./pages/Automation";
import TaskLogs from "./pages/TaskLogs";
import ApiDocs from "./pages/ApiDocs";
import PhoneNumbers from "./pages/PhoneNumbers";

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/accounts" component={Accounts} />
        <Route path="/import" component={ImportAccounts} />
        <Route path="/phones" component={PhoneNumbers} />
        <Route path="/invitation-tree" component={InvitationTree} />
        <Route path="/automation" component={Automation} />
        <Route path="/logs" component={TaskLogs} />
        <Route path="/api-docs" component={ApiDocs} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
