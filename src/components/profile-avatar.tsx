import { avatarUrl, displayName, type Profile } from '@/lib/supabase';

export default function ProfileAvatar({ profile }: { profile: Profile | null }) {
  const src = avatarUrl(profile);
  return src
    ? <img className="avatar" src={src} alt={`Аватар ${displayName(profile)}`} />
    : <span className="avatar initials">{displayName(profile).slice(0, 1).toUpperCase()}</span>;
}
