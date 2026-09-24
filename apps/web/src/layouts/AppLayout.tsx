import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Building2, ChevronsUpDown, Languages, LogOut, Menu as MenuIcon, Search, UserCircle2, X } from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { visibleSections } from '@/permissions/navigation';
import { CommandPalette } from '@/components/CommandPalette';
import { Avatar, Badge, useToast } from '@/components/ui';
import { setLanguage } from '@/i18n';
import { authApi } from '@/services/endpoints';
import { errorMessage } from '@/utils/errors';
import { useQueryClient } from '@tanstack/react-query';

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const { user, canAny, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

  if (!user) return null;
  const sections = visibleSections(canAny);
  const membership = user.activeMembership;

  const switchTo = async (membershipId: string) => {
    try {
      await authApi.switchChamber(membershipId);
      queryClient.clear();
      navigate('/');
      window.location.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const sidebar = (
    <nav aria-label={t('nav.main_menu')} className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
        <img src="/favicon.svg" alt="" className="h-7 w-7" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{t('app.name')}</p>
          <p className="truncate text-2xs text-ink-subtle">{t('app.tagline')}</p>
        </div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {sections.map((section) => (
          <div key={section.key ?? 'root'}>
            {section.key && <p className="mb-1.5 px-2 text-2xs font-semibold uppercase tracking-wider text-ink-subtle">{t(`nav.${section.key}`)}</p>}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                if (!item.available) {
                  return (
                    <li key={item.key}>
                      <span className="flex cursor-not-allowed items-center gap-2.5 rounded px-2 py-1.5 text-sm text-ink-subtle" aria-disabled="true">
                        <Icon className="h-4 w-4" aria-hidden />
                        <span className="flex-1">{t(`nav.${item.key}`)}</span>
                        <Badge className="!px-1.5 !py-0">{t('common.coming_soon')}</Badge>
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={item.key}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      className={({ isActive }) =>
                        clsx(
                          'flex items-center gap-2.5 rounded px-2 py-1.5 text-sm font-medium transition-colors',
                          isActive ? 'bg-primary-50 text-primary-800' : 'text-ink-muted hover:bg-canvas hover:text-ink',
                        )
                      }
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                      {t(`nav.${item.key}`)}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-3 text-2xs text-ink-subtle">{t('auth.secure_notice')}</div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border bg-surface lg:block">{sidebar}</aside>

      {mobileOpen && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-72 bg-surface shadow-overlay">
            <button
              type="button"
              className="absolute right-2 top-3 rounded p-1.5 text-ink-subtle hover:bg-canvas"
              onClick={() => setMobileOpen(false)}
              aria-label={t('common.close')}
            >
              <X className="h-4 w-4" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur sm:px-6">
          <button type="button" className="rounded p-1.5 text-ink-muted hover:bg-canvas lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t('nav.open_menu')}>
            <MenuIcon className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded border border-border bg-canvas px-3 text-left text-sm text-ink-subtle hover:border-ink-subtle/40 sm:max-w-sm"
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{t('command.placeholder')}</span>
            <kbd className="ml-auto hidden rounded border border-border bg-surface px-1.5 text-2xs sm:inline">Ctrl K</kbd>
          </button>

          <div className="ml-auto flex items-center gap-2">
            {membership.chamber && (
              <div className="relative hidden md:block">
                {user.memberships.length > 1 ? (
                  <label className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-ink-muted">
                    <Building2 className="h-3.5 w-3.5" aria-hidden />
                    <span className="sr-only">{t('nav.switch_chamber')}</span>
                    <select
                      className="bg-transparent pr-1 text-xs font-medium text-ink outline-none"
                      value={membership.id}
                      onChange={(e) => void switchTo(e.target.value)}
                    >
                      {user.memberships.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.chamber?.name ?? t('roles.SUPER_ADMIN')}
                        </option>
                      ))}
                    </select>
                    <ChevronsUpDown className="h-3 w-3" aria-hidden />
                  </label>
                ) : (
                  <span className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium text-ink-muted">
                    <Building2 className="h-3.5 w-3.5" aria-hidden />
                    {membership.chamber.name}
                  </span>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => setLanguage(i18n.language === 'bn' ? 'en' : 'bn')}
              className="flex h-8 items-center gap-1 rounded px-2 text-xs font-medium text-ink-muted hover:bg-canvas"
              aria-label={t('common.language')}
            >
              <Languages className="h-4 w-4" aria-hidden />
              {i18n.language === 'bn' ? 'EN' : 'বাং'}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                className="flex items-center gap-2 rounded p-1 hover:bg-canvas"
              >
                <Avatar name={user.fullName} size="sm" />
                <span className="hidden text-left sm:block">
                  <span className="block max-w-[10rem] truncate text-xs font-medium text-ink">{user.fullName}</span>
                  <span className="block text-2xs text-ink-subtle">{t(`roles.${membership.role}`)}</span>
                </span>
              </button>
              {userMenuOpen && (
                <div role="menu" className="absolute right-0 mt-1 w-52 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-overlay">
                  <NavLink role="menuitem" to="/profile" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-canvas">
                    <UserCircle2 className="h-4 w-4" aria-hidden />
                    {t('nav.profile')}
                  </NavLink>
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => void signOut().then(() => navigate('/login'))}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-canvas"
                  >
                    <LogOut className="h-4 w-4" aria-hidden />
                    {t('nav.sign_out')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
