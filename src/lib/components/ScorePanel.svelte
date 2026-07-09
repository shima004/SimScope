<script lang="ts">
  import { t } from "$lib/i18n";
  import { EntityURN } from "$lib/rcrs/urns";
  import {
    currentStep,
    entities,
    initialBlockadeCost,
  } from "$lib/stores/simulation";

  const MAX_HP = 10000;

  const blockadeResult = $derived.by(() => {
    if ($initialBlockadeCost === 0) return null;
    if ($currentStep === 0) return { pct: 0, total: $initialBlockadeCost };
    let current = 0;
    for (const e of $entities.values()) {
      if ("repairCost" in e)
        current += (e as { repairCost: number }).repairCost;
    }
    const pct = (($initialBlockadeCost - current) / $initialBlockadeCost) * 100;
    return { pct, total: $initialBlockadeCost };
  });

  const refugeResult = $derived.by(() => {
    let injured = 0;
    let inRefuge = 0;
    for (const e of $entities.values()) {
      if (e.urn !== EntityURN.CIVILIAN) continue;
      const c = e as { hp: number; position: number };
      if (!("hp" in e) || c.hp >= MAX_HP) continue;
      injured++;
      const pos = $entities.get(c.position);
      if (pos?.urn === EntityURN.REFUGE) inRefuge++;
    }
    return { inRefuge, injured };
  });

  const agentCounts = $derived.by(() => {
    let fb = 0,
      at = 0,
      pf = 0,
      cv = 0;
    for (const e of $entities.values()) {
      if (e.urn === EntityURN.FIRE_BRIGADE) fb++;
      else if (e.urn === EntityURN.AMBULANCE_TEAM) at++;
      else if (e.urn === EntityURN.POLICE_FORCE) pf++;
      else if (e.urn === EntityURN.CIVILIAN) cv++;
    }
    return { fb, at, pf, cv };
  });

  const result = $derived.by(() => {
    let civilians = 0;
    let total = 0;
    let hp = 0;
    let max = 0;
    for (const e of $entities.values()) {
      if (e.urn !== EntityURN.CIVILIAN) continue;
      const c = e as { hp: number };
      total++;
      if ("hp" in e) {
        hp += c.hp;
        if (c.hp > 0) civilians++;
      }
      max += MAX_HP;
    }
    if (max === 0) return null;
    const score = civilians * Math.exp(-5 * (1 - hp / max));
    return { score, maxScore: total };
  });
</script>

{#if result !== null || blockadeResult !== null || agentCounts.fb + agentCounts.at + agentCounts.pf > 0}
  <div class="panel">
    {#if result !== null}
      <div class="row">
        <span class="label">{$t("score.score")}</span>
        <span class="value"
          >{result.score.toFixed(2)}<span class="max">
            / {result.maxScore}</span
          ></span
        >
      </div>
    {/if}
    {#if refugeResult !== null && result !== null}
      <div class="row">
        <span class="label">{$t("score.injuredInRefuge")}</span>
        <span class="value"
          >{refugeResult.inRefuge}<span class="max">
            / {refugeResult.injured}</span
          ></span
        >
      </div>
    {/if}
    {#if blockadeResult !== null}
      <div class="row">
        <span class="label">{$t("score.blockadeCleared")}</span>
        <span class="value"
          >{blockadeResult.pct.toFixed(1)}<span class="max">%</span></span
        >
      </div>
    {/if}
    {#if agentCounts.fb + agentCounts.at + agentCounts.pf > 0}
      <div class="divider"></div>
      <div class="agent-counts">
        <span class="agent-item" title={$t("entity.fireBrigade")}>🚒 {agentCounts.fb}</span>
        <span class="agent-item" title={$t("entity.ambulanceTeam")}
          >🚑 {agentCounts.at}</span
        >
        <span class="agent-item" title={$t("entity.policeForce")}>🚜 {agentCounts.pf}</span>
        <span class="agent-item" title={$t("entity.civilian")}>🧍 {agentCounts.cv}</span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .panel {
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(13, 20, 30, 0.92);
    border: 1px solid rgba(0, 200, 255, 0.2);
    border-radius: 6px;
    padding: 6px 12px;
    line-height: 1.2;
    backdrop-filter: blur(6px);
    box-shadow: 0 0 20px rgba(0, 180, 255, 0.08);
    z-index: 10;
    min-height: 40px;
  }

  .label {
    font-size: 10px;
    line-height: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #00c8ff;
  }

  .value {
    font-size: 16px;
    line-height: 18px;
    font-variant-numeric: tabular-nums;
    color: #c8d8e8;
    font-weight: 600;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 24px;
    white-space: nowrap;
  }

  .divider {
    width: 1px;
    align-self: stretch;
    background: rgba(0, 200, 255, 0.1);
    margin: 0 1px;
  }

  .agent-counts {
    display: flex;
    gap: 10px;
    align-items: center;
    min-height: 24px;
  }

  .agent-item {
    font-size: 12px;
    line-height: 15px;
    color: #a8c8d8;
    font-variant-numeric: tabular-nums;
  }

  .max {
    font-size: 12px;
    line-height: 15px;
    color: #607080;
    font-weight: 400;
  }

  @media (max-width: 720px) {
    .panel {
      flex-wrap: wrap;
      gap: 6px 10px;
    }

    .divider {
      display: none;
    }
  }
</style>
