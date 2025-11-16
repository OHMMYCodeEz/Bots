-- Blox Fruits: Auto-Loop Drop + Equip (Pepsi's UI - ถือผลทันทีเมื่อเปิด)
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local player = Players.LocalPlayer

-- โหลด Pepsi's UI Library
local library = loadstring(game:GetObjects("rbxassetid://7657867786")[1].Source)()

-- รายชื่อผลปีศาจทั้ง 41 ตัว (จาก Wiki)
local FRUIT_KEYWORDS = {
	"Rocket", "Spin", "Blade", "Spring", "Bomb", "Smoke", "Spike",
	"Flame", "Ice", "Sand", "Dark", "Eagle", "Diamond",
	"Light", "Rubber", "Ghost", "Magma",
	"Quake", "Buddha", "Love", "Creation", "Spider", "Sound", "Phoenix", "Portal", "Lightning", "Pain", "Blizzard",
	"Gravity", "Mammoth", "T-Rex", "Dough", "Shadow", "Venom", "Control", "Gas", "Spirit", "Tiger", "Yeti", "Kitsune", "Dragon"
}

-- สถานะ
local autoLoop = false
local loopConnection = nil

-- ตัวแปรสำหรับ UI
local Window, GeneralTab, FarmingSection, LoopToggle, NextLabel, CountLabel

-- === ฟังก์ชัน ===
local function isDevilFruit(tool)
	if not tool or not tool:IsA("Tool") then return false end
	local name = tool.Name:lower()
	for _, kw in ipairs(FRUIT_KEYWORDS) do
		if name:find(kw:lower()) then return true end
	end
	return false
end

local function getEatRemote(tool)
	return tool:FindFirstChild("EatRemote", true)
end

local function getNextFruit()
	local backpack = player:FindFirstChild("Backpack")
	if not backpack then return nil end
	for _, tool in pairs(backpack:GetChildren()) do
		if isDevilFruit(tool) and getEatRemote(tool) then
			return tool
		end
	end
	return nil
end

local function countFruits()
	local count = 0
	local backpack = player:FindFirstChild("Backpack")
	if backpack then
		for _, tool in pairs(backpack:GetChildren()) do
			if isDevilFruit(tool) then count += 1 end
		end
	end
	local char = player.Character
	if char then
		local equipped = char:FindFirstChildOfClass("Tool")
		if equipped and isDevilFruit(equipped) then count += 1 end
	end
	return count
end

local function dropCurrent()
	local char = player.Character
	if not char then return false end
	local tool = char:FindFirstChildOfClass("Tool")
	if not tool or not isDevilFruit(tool) then return false end
	local eatRemote = getEatRemote(tool)
	if not eatRemote then return false end
	pcall(function()
		eatRemote:InvokeServer("Drop")
	end)
	return true
end

local function equipNext()
	local nextFruit = getNextFruit()
	if not nextFruit then return false end
	local char = player.Character
	if char and char:FindFirstChildOfClass("Humanoid") then
		char.Humanoid:EquipTool(nextFruit)
		wait(1)  -- รอแค่ 0.6 วินาที (เร็ว + ปลอดภัย)
		return nextFruit
	end
	return false
end

-- === เริ่ม Loop ===
local function startLoop()
	if loopConnection then loopConnection:Disconnect() end
	loopConnection = RunService.Heartbeat:Connect(function()
		if not autoLoop then return end
		if countFruits() <= 1 then
			autoLoop = false
			if NextLabel then NextLabel:Set("Next Fruit: No Fruit") end
			if CountLabel then CountLabel:Set("Fruit All: 0") end
			LoopToggle:Set(false)
			return
		end
		if dropCurrent() then
			wait(1)
			local nextF = equipNext()
			if nextF and NextLabel then
				NextLabel:Set("Next Fruit: " .. nextF.Name)
			end
		end
	end)
end

-- === เปิด Toggle → ถือผลทันที + เริ่ม Loop ===
local function onToggle(value)
	autoLoop = value
	if value then
		-- ถือผลทันที (ถ้ายังไม่ถือ)
		spawn(function()
			wait(1)
			local currentTool = player.Character and player.Character:FindFirstChildOfClass("Tool")
			if not currentTool or not isDevilFruit(currentTool) then
				equipNext()  -- ถือผลแรกทันที
			end
			startLoop()  -- เริ่มวน Drop → Equip
		end)
	else
		if loopConnection then loopConnection:Disconnect() end
	end
end

-- === สร้าง Pepsi's UI ===
Window = library:CreateWindow({
	Name = "Maru Hub",
	Themeable = { Info = "Blox Fruits Script 2025" }
})

GeneralTab = Window:CreateTab({ Name = "Fruit" })
FarmingSection = GeneralTab:CreateSection({ Name = "Fruit" })

-- Toggle
LoopToggle = FarmingSection:AddToggle({
	Name = "Auto Drop Fruit",
	Flag = "AutoLoopFlag",
	Callback = onToggle
})

-- Label
NextLabel = FarmingSection:AddLabel({ Name = "Next Fruit: waitload..." })
CountLabel = FarmingSection:AddLabel({ Name = "Fruit All: 0" })

-- === อัพเดท UI ===
spawn(function()
	while wait(0.8) do
		pcall(function()
			local nextFruit = getNextFruit()
			if nextFruit then
				NextLabel:Set("Next Fruit: " .. nextFruit.Name)
			else
				NextLabel:Set("Next Fruit: No Fruit")
			end
			CountLabel:Set("Fruit All: " .. countFruits())
		end)
	end
end)

print("Maru Hub: Auto Drop Fruit โหลดแล้ว! (เปิด Toggle = ถือผล + วนอัตโนมัติ)")