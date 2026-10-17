// One single footer shared by the Home and About Us pages: logo and name with
// a short description on the left, "Developed by" credit on the right. No
// second bottom bar.
export default function MarketingFooter() {
  return (
    <footer className="border-t border-line bg-pagebg">
      <div className="max-w-6xl mx-auto px-6 py-12 flex flex-col md:flex-row md:justify-between gap-8">
        <div className="max-w-md">
          <div className="flex items-center gap-3 mb-5">
            <span className="text-xl font-bold text-ems-primary tracking-tight">EMS</span>
          </div>
          <p className="text-sm text-ink-muted leading-relaxed">
            A digital platform for managing institutional events, communications, reporting, and engagement in
            one workspace.
          </p>
        </div>
      </div>
    </footer>
  );
}
