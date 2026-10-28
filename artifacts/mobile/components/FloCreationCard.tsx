import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useColors } from "@/hooks/useColors";
import type { FloCreationResult } from "@/lib/floCreationProtocol";
export function FloCreationCard({creation,onOpen,onCancel}:{creation:FloCreationResult;onOpen:(route:string)=>void;onCancel?:()=>void}){
 const c=useColors();
 if(creation.status==="saved"&&creation.receipt)return <View style={[styles.card,{borderColor:c.border,backgroundColor:c.card}]}><View style={styles.row}><Feather name="check-circle"size={18}color={c.primary}/><View style={{flex:1}}><Text style={{color:c.mutedForeground,fontSize:12}}>Saved</Text><Text numberOfLines={2} style={{color:c.foreground,fontWeight:"600",fontSize:15}}>{creation.receipt.title}</Text></View><Pressable accessibilityRole="button"accessibilityLabel={`Open ${creation.receipt.title}`}onPress={()=>onOpen(creation.receipt!.route)}style={styles.action}><Text style={{color:c.primary,fontWeight:"600"}}>Open</Text><Feather name="chevron-right"size={16}color={c.primary}/></Pressable></View></View>;
 if(creation.status==="ready")return <View style={[styles.card,{borderColor:c.border,backgroundColor:c.card}]}><Text accessibilityLiveRegion="polite"style={{color:c.mutedForeground}}>Checking and saving…</Text></View>;
 if(creation.status==="needs_details"&&onCancel)return <Pressable accessibilityRole="button"accessibilityLabel="Cancel creation draft"onPress={onCancel}style={styles.cancel}><Text style={{color:c.mutedForeground}}>Cancel draft</Text></Pressable>;
 return null;
}
const styles=StyleSheet.create({card:{borderWidth:1,borderRadius:14,padding:12,marginTop:8},row:{flexDirection:"row",alignItems:"center",gap:10},action:{minHeight:44,minWidth:64,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:2},cancel:{minHeight:44,alignSelf:"flex-start",justifyContent:"center",paddingHorizontal:4}});
