'use client';

import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import * as React from 'react';

import { setLocale, type Locale } from '@/actions/locale';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Icons } from '@/components/ui/icon';

export interface UserInfo {
  name: string;
  email: string;
  avatarUrl?: string;
}

interface UserMenuProps {
  user?: UserInfo;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function UserMenu({ user }: UserMenuProps) {
  const { theme, setTheme } = useTheme();
  const t = useTranslations('auth');
  const [locale, setLocaleState] = React.useState<Locale>('it');

  const displayName = user?.name ?? t('default_user');
  const email = user?.email ?? '';
  const initials = getInitials(displayName);

  async function handleLocaleChange(value: string) {
    const next = value as Locale;
    setLocaleState(next);
    await setLocale(next);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-full outline-none ring-ring focus-visible:ring-2"
          aria-label={t('user_menu_label')}
          data-testid="user-menu-trigger"
        >
          <Avatar className="h-8 w-8">
            {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={displayName} />}
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56" data-testid="user-menu-content">
        {/* Identity header */}
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium leading-none" data-testid="user-menu-name">
              {displayName}
            </span>
            <span className="text-xs leading-none text-muted-foreground" data-testid="user-menu-email">
              {email}
            </span>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {/* Profile and settings */}
        <DropdownMenuItem asChild>
          <a href="/settings/profile" data-testid="user-menu-profile">
            <Icons.User className="mr-2" />
            {t('profile')}
          </a>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <a href="/settings" data-testid="user-menu-settings">
            <Icons.Settings className="mr-2" />
            {t('settings')}
          </a>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Language submenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="user-menu-lingua-trigger">
            <Icons.Globe className="mr-2" />
            {t('language')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent data-testid="user-menu-lingua-content">
            <DropdownMenuRadioGroup value={locale} onValueChange={handleLocaleChange}>
              <DropdownMenuRadioItem value="it" data-testid="user-menu-locale-it">
                {t('locale_it')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="en" data-testid="user-menu-locale-en">
                {t('locale_en')}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Theme submenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="user-menu-tema-trigger">
            <Icons.Sun className="mr-2" />
            {t('theme')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent data-testid="user-menu-tema-content">
            <DropdownMenuRadioGroup value={theme ?? 'light'} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="light" data-testid="user-menu-theme-light">
                <Icons.Sun className="mr-2" />
                {t('theme_light')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark" data-testid="user-menu-theme-dark">
                <Icons.Moon className="mr-2" />
                {t('theme_dark')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system" data-testid="user-menu-theme-system">
                <Icons.Monitor className="mr-2" />
                {t('theme_system')}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        {/* Sign out */}
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          data-testid="user-menu-signout"
          onClick={() => {
            // Auth sign-out wired in plan 04
            window.location.href = '/api/auth/signout';
          }}
        >
          <Icons.LogOut className="mr-2" />
          {t('sign_out')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
