import { db } from "@/lib/db";

async function seed() {
  // Create sample games
  const games = [
    { name: "Adopt Me!", placeId: "920587237", description: "Adopt and raise cute pets", playerCount: 85600, status: "online", thumbnail: "adoptme" },
    { name: "Blox Fruits", placeId: "2753915549", description: "Find and eat fruits for powers", playerCount: 328700, status: "online", thumbnail: "bloxfruits" },
    { name: "Brookhaven RP", placeId: "4924922222", description: "Roleplay in a vibrant city", playerCount: 112400, status: "online", thumbnail: "brookhaven" },
    { name: "Tower of Hell", placeId: "1962086868", description: "Climb the obby tower", playerCount: 4500, status: "online", thumbnail: "tower" },
    { name: "Murder Mystery 2", placeId: "142823291", description: "Solve the mystery or be the killer", playerCount: 8900, status: "online", thumbnail: "mm2" },
    { name: "Pet Simulator X", placeId: "6284583030", description: "Collect and trade pets", playerCount: 25200, status: "online", thumbnail: "petsim" },
    { name: "Bee Swarm Simulator", placeId: "1537690962", description: "Grow your bee swarm", playerCount: 6100, status: "online", thumbnail: "bee" },
    { name: "Jailbreak", placeId: "606849621", description: "Escape or enforce the law", playerCount: 15800, status: "online", thumbnail: "jailbreak" },
    { name: "Arsenal", placeId: "286090429", description: "Fast-paced FPS game", playerCount: 7200, status: "online", thumbnail: "arsenal" },
    { name: "King Legacy", placeId: "2809202155", description: "Sail the seas for treasure", playerCount: 18900, status: "online", thumbnail: "kinglegacy" },
    { name: "Anime Fighters Simulator", placeId: "6292707986", description: "Collect anime fighters", playerCount: 3200, status: "online", thumbnail: "animefighters" },
    { name: "Shindo Life", placeId: "4623386850", description: "Ninja battling game", playerCount: 5600, status: "online", thumbnail: "shindo" },
  ];

  for (const game of games) {
    await db.game.upsert({
      where: { placeId: game.placeId },
      update: { playerCount: game.playerCount, status: game.status },
      create: game,
    });
  }

  // Create sample scripts
  const scripts = [
    { name: "Auto Farm Script", description: "Automatically farms resources in your current game", code: '-- Auto Farm Script\nlocal player = game.Players.LocalPlayer\nprint("Auto Farm started!")', category: "farming", isPublic: true, usageCount: 15420 },
    { name: "Speed Hack", description: "Increases your movement speed", code: '-- Speed Script\nlocal player = game.Players.LocalPlayer\nlocal char = player.Character\nchar.Humanoid.WalkSpeed = 100', category: "movement", isPublic: true, usageCount: 8930 },
    { name: "ESP Script", description: "See players through walls", code: '-- ESP Script\nlocal players = game.Players:GetPlayers()\nfor _, p in pairs(players) do\n  print(p.Name)\nend', category: "visual", isPublic: true, usageCount: 12100 },
    { name: "Infinite Jump", description: "Jump infinitely without falling", code: '-- Infinite Jump\nlocal uis = game.UserInputService\nuis.JumpRequest:Connect(function()\n  game.Players.LocalPlayer.Character:FindFirstChildOfClass("Humanoid"):ChangeState("Jumping")\nend)', category: "movement", isPublic: true, usageCount: 6750 },
    { name: "Teleport Script", description: "Teleport to any location", code: '-- Teleport Script\nlocal target = CFrame.new(100, 50, 100)\ngame.Players.LocalPlayer.Character.HumanoidRootPart.CFrame = target', category: "utility", isPublic: true, usageCount: 9200 },
    { name: "Anti-AFK", description: "Prevent being kicked for inactivity", code: '-- Anti AFK\nlocal vu = game.VirtualUser\ngame.Players.LocalPlayer.Idled:Connect(function()\n  vu:CaptureController()\n  vu:ClickButton2(Vector2.new())\nend)', category: "utility", isPublic: true, usageCount: 22300 },
  ];

  for (const script of scripts) {
    const existing = await db.script.findFirst({ where: { name: script.name } });
    if (!existing) {
      await db.script.create({ data: script });
    }
  }

  // Create sample servers for games
  const allGames = await db.game.findMany();
  for (const game of allGames) {
    const serverCount = Math.floor(Math.random() * 5) + 1;
    for (let i = 0; i < serverCount; i++) {
      await db.server.create({
        data: {
          gameId: game.id,
          name: `${game.name} Server #${i + 1}`,
          status: Math.random() > 0.1 ? "online" : "offline",
          playerCount: Math.floor(Math.random() * game.playerCount * 0.3) + 1,
        },
      });
    }
  }

  console.log("Seed completed successfully!");
}

seed()
  .catch(console.error)
  .finally(() => process.exit());
