export type Role = { id: string; rank: number; name: string; isBase?: boolean };
export type Staff = {
  id: string;
  username: string;
  displayName: string;
  rank: number;
  role: string;
  avatar?: string;
};
export type Job = {
  id: string;
  command: string;
  action: string;
  target_role_name?: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  created_at: string;
  error?: string;
  paused?: boolean;
};
export type State = {
  roles: Role[];
  staff: Staff | null;
  jobs: Job[];
  ready: boolean;
  notice?: string;
  connection?: {
    username?: string;
    userId?: string;
    readScope: boolean;
    writeScope: boolean;
    moderationConnected: boolean;
    error?: string;
  };
};
export const initialRoles: Role[] = [
  { id: "682597013", rank: 0, name: "Guest" },
  { id: "12884901889", rank: 1, name: "Member", isBase: true },
  { id: "774502058", rank: 2, name: "Owner's alt for test" },
  { id: "734693015", rank: 3, name: "Servers Protector" },
  { id: "684523010", rank: 4, name: "Tester" },
  { id: "683455013", rank: 5, name: "Contributor" },
  { id: "682931024", rank: 6, name: "Mod Under Training" },
  { id: "682961014", rank: 7, name: "Moderator" },
  { id: "682117014", rank: 8, name: "Supervisor of Moderator" },
  { id: "682597014", rank: 9, name: "Admin" },
  { id: "682877028", rank: 10, name: "Supervisor of Administration" },
  { id: "688725015", rank: 11, name: "Developer" },
  { id: "683403004", rank: 12, name: "Co owner" },
  { id: "779165048", rank: 13, name: "Head Co Owner" },
  { id: "688939008", rank: 14, name: "Management" },
  { id: "682597012", rank: 255, name: "Owner" },
];
